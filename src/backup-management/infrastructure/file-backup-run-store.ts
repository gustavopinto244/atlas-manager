import { appendFile, mkdir, readFile, lstat, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { BackupRun } from "../domain/backup-run.js";
import type {
  BackupRunQuery,
  BackupRunStore,
  BackupRunStoreSnapshot,
} from "../application/ports/backup-ports.js";
import { InMemoryBackupRunStore } from "./in-memory-backup-run-store.js";
import { parseStrictJson } from "../../config/strict-json.js";

const MAX_LINE_BYTES = 32 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export class FileBackupRunStore implements BackupRunStore {
  readonly #path: string;
  readonly #memory = new InMemoryBackupRunStore();
  #loaded = false;

  public constructor(path: string) {
    this.#path = path;
  }

  public async appendStarted(run: BackupRun): Promise<void> {
    await this.load();
    validateRun(run, "started");
    await this.append({ kind: "started", run });
    await this.#memory.appendStarted(run);
  }

  public async appendTerminal(run: BackupRun): Promise<void> {
    await this.load();
    validateRun(run, "terminal");
    await this.append({ kind: "terminal", run });
    await this.#memory.appendTerminal(run);
  }

  public async getByRunId(runId: string): Promise<BackupRun | null> {
    await this.load();
    return this.#memory.getByRunId(runId);
  }
  public async query(input?: BackupRunQuery): Promise<readonly BackupRun[]> {
    await this.load();
    return this.#memory.query(input);
  }
  public async reconstruct(): Promise<BackupRunStoreSnapshot> {
    await this.load();
    return this.#memory.reconstruct();
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    let data: Buffer;
    try {
      const info = await lstat(this.#path);
      if (!info.isFile() || info.nlink !== 1 || info.mode & 0o022)
        throw new Error("backup_run_history_unsafe");
      if (info.size > MAX_FILE_BYTES)
        throw new Error("backup_run_history_too_large");
      data = await readFile(this.#path);
    } catch (error) {
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return;
      throw error;
    }
    const lines = data
      .toString("utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    for (const line of lines) {
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES)
        throw new Error("backup_run_history_line_too_large");
      const entry = parseStrictJson(line);
      if (!isEntry(entry)) throw new Error("backup_run_history_corrupt");
      validateRun(entry.run, entry.kind);
      if (entry.kind === "started") await this.#memory.appendStarted(entry.run);
      else await this.#memory.appendTerminal(entry.run);
    }
  }

  private async append(entry: {
    readonly kind: "started" | "terminal";
    readonly run: BackupRun;
  }): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const parent = await lstat(dirname(this.#path));
    if (!parent.isDirectory() || (parent.mode & 0o077) !== 0)
      throw new Error("backup_run_history_parent_unsafe");
    try {
      const info = await lstat(this.#path);
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
        throw new Error("backup_run_history_unsafe");
    } catch (error) {
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        const handle = await open(this.#path, "wx", 0o600);
        await handle.close();
      } else throw error;
    }
    const data = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
    if (data.length > MAX_LINE_BYTES)
      throw new Error("backup_run_history_line_too_large");
    await appendFile(this.#path, data, { mode: 0o600 });
  }
}

function isEntry(
  value: unknown,
): value is { readonly kind: "started" | "terminal"; readonly run: BackupRun } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const entry = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(entry).length === 2 &&
    (entry.kind === "started" || entry.kind === "terminal") &&
    typeof entry.run === "object" &&
    entry.run !== null &&
    !Array.isArray(entry.run)
  );
}

function validateRun(
  value: unknown,
  kind: "started" | "terminal",
): asserts value is BackupRun {
  if (!isRecord(value) || Reflect.ownKeys(value).length !== 11)
    throw new Error("backup_run_history_corrupt");
  if (
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1
  )
    throw new Error("backup_run_history_corrupt");
  if (
    typeof value.runId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value.runId,
    )
  )
    throw new Error("backup_run_history_corrupt");
  if (
    typeof value.targetId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.targetId)
  )
    throw new Error("backup_run_history_corrupt");
  if (value.trigger !== "manual" && value.trigger !== "scheduled")
    throw new Error("backup_run_history_corrupt");
  for (const field of ["requestedAt", "startedAt"] as const) {
    if (
      typeof value[field] !== "string" ||
      Number.isNaN(Date.parse(value[field]))
    )
      throw new Error("backup_run_history_corrupt");
  }
  if (
    value.scheduledFor !== null &&
    (typeof value.scheduledFor !== "string" ||
      Number.isNaN(Date.parse(value.scheduledFor)))
  )
    throw new Error("backup_run_history_corrupt");
  if (kind === "started") {
    if (
      value.status !== "started" ||
      value.completedAt !== null ||
      value.artifact !== null ||
      value.failureCode !== null
    )
      throw new Error("backup_run_history_corrupt");
    return;
  }
  if (
    value.status !== "succeeded" &&
    value.status !== "failed" &&
    value.status !== "interrupted"
  )
    throw new Error("backup_run_history_corrupt");
  if (
    typeof value.completedAt !== "string" ||
    Number.isNaN(Date.parse(value.completedAt))
  )
    throw new Error("backup_run_history_corrupt");
  if (value.status === "succeeded") {
    if (
      !isRecord(value.artifact) ||
      Reflect.ownKeys(value.artifact).length !== 4 ||
      value.failureCode !== null ||
      typeof value.artifact.fileCount !== "number" ||
      typeof value.artifact.totalBytes !== "number" ||
      typeof value.artifact.manifestSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(value.artifact.manifestSha256) ||
      typeof value.artifact.completedAt !== "string"
    )
      throw new Error("backup_run_history_corrupt");
  } else if (value.artifact !== null || typeof value.failureCode !== "string") {
    throw new Error("backup_run_history_corrupt");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
