import { randomUUID } from "node:crypto";
import { mkdir, readFile, lstat, open, rm, writeFile } from "node:fs/promises";
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
  #memory = new InMemoryBackupRunStore();
  #state: "unloaded" | "loading" | "ready" | "failed" = "unloaded";
  #loading: Promise<void> | undefined;
  #failure: Error | undefined;
  #snapshot: Buffer | null | undefined;

  public constructor(path: string) {
    this.#path = path;
  }

  public async appendStarted(run: BackupRun): Promise<void> {
    await this.withWriterLock(async () => {
      await this.ensureUsable();
      validateRun(run, "started");
      if (run.sequence !== (await this.allocateNextSequence()))
        throw new Error("backup_sequence_conflict");
      try {
        await this.#memory.appendStarted(run);
      } catch (error) {
        this.fail(error);
        throw this.failureError();
      }
      try {
        await this.append({ kind: "started", run });
      } catch (error) {
        this.fail(error);
        throw this.failureError();
      }
      await this.refreshSnapshot();
    });
  }

  public async appendTerminal(run: BackupRun): Promise<void> {
    await this.withWriterLock(async () => {
      await this.ensureUsable();
      validateRun(run, "terminal");
      try {
        await this.#memory.appendTerminal(run);
      } catch (error) {
        this.fail(error);
        throw this.failureError();
      }
      try {
        await this.append({ kind: "terminal", run });
      } catch (error) {
        this.fail(error);
        throw this.failureError();
      }
      await this.refreshSnapshot();
    });
  }

  public async allocateNextSequence(): Promise<number> {
    await this.ensureUsable();
    const snapshot = await this.#memory.reconstruct();
    const sequences = snapshot.runs.map((run) => run.sequence);
    const active = snapshot.interrupted.map((run) => run.sequence);
    const all = [...sequences, ...active];
    return all.length === 0 ? 1 : Math.max(...all) + 1;
  }

  public async getByRunId(runId: string): Promise<BackupRun | null> {
    await this.ensureUsable();
    return this.#memory.getByRunId(runId);
  }
  public async query(input?: BackupRunQuery): Promise<readonly BackupRun[]> {
    await this.ensureUsable();
    return this.#memory.query(input);
  }
  public async reconstruct(): Promise<BackupRunStoreSnapshot> {
    await this.ensureUsable();
    return this.#memory.reconstruct();
  }

  async load(): Promise<void> {
    await this.ensureUsable();
  }

  private async ensureUsable(): Promise<void> {
    if (this.#state === "failed") throw this.failureError();
    if (this.#state === "loading") {
      await this.#loading;
      return this.ensureUsable();
    }
    if (this.#state === "unloaded") {
      this.#state = "loading";
      this.#loading = this.reconstructFromDisk();
      try {
        await this.#loading;
        this.#state = "ready";
      } catch (error) {
        this.fail(error);
        throw this.failureError();
      } finally {
        this.#loading = undefined;
      }
      return;
    }
    const current = await readHistory(this.#path);
    if (sameBytes(current, this.#snapshot ?? null)) return;
    if (
      this.#snapshot !== undefined &&
      !isAppendOnlyChange(this.#snapshot, current)
    ) {
      const error = new Error("backup_run_history_corrupt");
      this.fail(error);
      throw error;
    }
    try {
      await this.reconstructFromData(current);
    } catch (error) {
      this.fail(error);
      throw this.failureError();
    }
  }

  private async reconstructFromDisk(): Promise<void> {
    const data = await readHistory(this.#path);
    await this.reconstructFromData(data);
  }

  private async reconstructFromData(data: Buffer | null): Promise<void> {
    if (data === null) {
      this.#snapshot = null;
      this.#memory = new InMemoryBackupRunStore();
      return;
    }
    const memory = new InMemoryBackupRunStore();
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
      if (entry.kind === "started") await memory.appendStarted(entry.run);
      else await memory.appendTerminal(entry.run);
    }
    this.#memory = memory;
    this.#snapshot = Buffer.from(data);
  }

  private async refreshSnapshot(): Promise<void> {
    const data = await readHistory(this.#path);
    this.#snapshot = data === null ? null : Buffer.from(data);
  }

  private async withWriterLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.#path}.lock`;
    let acquired = false;
    try {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      await mkdir(lockPath, { mode: 0o700 });
      acquired = true;
      await writeFile(
        `${lockPath}/owner.json`,
        JSON.stringify({ schemaVersion: 1, ownerToken: randomToken() }) + "\n",
        { mode: 0o600, flag: "wx" },
      );
    } catch (error) {
      if (acquired) await rm(lockPath, { recursive: true, force: true });
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      )
        throw new Error("backup_run_history_busy", { cause: error });
      throw new Error("backup_run_history_unavailable", { cause: error });
    }
    try {
      return await operation();
    } finally {
      await rm(lockPath, { recursive: true, force: false });
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
    const handle = await open(this.#path, "a");
    try {
      await handle.write(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private failureError(): Error {
    return this.#failure ?? new Error("backup_run_history_unavailable");
  }

  private fail(error: unknown): void {
    this.#failure =
      error instanceof Error
        ? error
        : new Error("backup_run_history_unavailable");
    this.#state = "failed";
  }
}

async function readHistory(path: string): Promise<Buffer | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o022)
      throw new Error("backup_run_history_unsafe");
    if (info.size > MAX_FILE_BYTES)
      throw new Error("backup_run_history_too_large");
    return await readFile(path);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return null;
    throw error;
  }
}

function sameBytes(
  left: Buffer | null | undefined,
  right: Buffer | null,
): boolean {
  if (left === undefined || left === null || right === null)
    return left === right;
  return left.equals(right);
}

function isAppendOnlyChange(
  previous: Buffer | null,
  current: Buffer | null,
): boolean {
  if (previous === null) return current !== null;
  return (
    current !== null &&
    current.length >= previous.length &&
    current.subarray(0, previous.length).equals(previous)
  );
}

function randomToken(): string {
  return randomUUID().replaceAll("-", "");
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
