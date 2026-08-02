import {
  appendFile,
  mkdir,
  readFile,
  lstat,
  open,
  rename,
} from "node:fs/promises";
import { dirname } from "node:path";
import type {
  BackupOccurrenceClaimStore,
  BackupSchedulerCursorStore,
} from "../application/ports/backup-ports.js";
import { parseStrictJson } from "../../config/strict-json.js";

const MAX_CLAIMS_BYTES = 16 * 1024 * 1024;
const MAX_CLAIM_LINE_BYTES = 512;

export class FileBackupOccurrenceClaimStore implements BackupOccurrenceClaimStore {
  readonly #path: string;
  readonly #claims = new Set<string>();
  #loaded = false;

  public constructor(path: string) {
    this.#path = path;
  }

  public async claim(
    targetId: string,
    scheduledFor: string,
  ): Promise<"claimed" | "duplicate"> {
    await this.load();
    const key = `${targetId}\n${scheduledFor}`;
    if (this.#claims.has(key)) return "duplicate";
    await ensurePrivateFile(this.#path);
    const line = JSON.stringify({ targetId, scheduledFor });
    if (Buffer.byteLength(line, "utf8") > MAX_CLAIM_LINE_BYTES)
      throw new Error("backup_claim_too_large");
    await appendFile(this.#path, `${line}\n`, { mode: 0o600 });
    this.#claims.add(key);
    return "claimed";
  }

  private async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    const data = await readPrivateFile(this.#path, MAX_CLAIMS_BYTES);
    if (data === null) return;
    for (const line of data.toString("utf8").split("\n").filter(Boolean)) {
      if (Buffer.byteLength(line, "utf8") > MAX_CLAIM_LINE_BYTES)
        throw new Error("backup_claim_corrupt");
      const value = parseStrictJson(line);
      if (
        !isRecord(value) ||
        Reflect.ownKeys(value).length !== 2 ||
        typeof value.targetId !== "string" ||
        typeof value.scheduledFor !== "string"
      )
        throw new Error("backup_claim_corrupt");
      const key = `${value.targetId}\n${value.scheduledFor}`;
      if (this.#claims.has(key)) throw new Error("backup_claim_duplicate");
      this.#claims.add(key);
    }
  }
}

export class FileBackupSchedulerCursorStore implements BackupSchedulerCursorStore {
  readonly #path: string;
  #value: string | null = null;
  #loaded = false;

  public constructor(path: string) {
    this.#path = path;
  }

  public async read(): Promise<string | null> {
    await this.load();
    return this.#value;
  }

  public async compareAndSet(
    expected: string | null,
    next: string,
  ): Promise<boolean> {
    await this.load();
    if (this.#value !== expected) return false;
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.candidate`;
    const data = Buffer.from(
      JSON.stringify({ schemaVersion: 1, value: next }) + "\n",
      "utf8",
    );
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.#path);
    this.#value = next;
    return true;
  }

  private async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    const data = await readPrivateFile(this.#path, 4_096);
    if (data === null) return;
    const value = parseStrictJson(data.toString("utf8"));
    if (
      !isRecord(value) ||
      Reflect.ownKeys(value).length !== 2 ||
      value.schemaVersion !== 1 ||
      typeof value.value !== "string" ||
      Number.isNaN(Date.parse(value.value))
    )
      throw new Error("backup_cursor_corrupt");
    this.#value = value.value;
  }
}

async function ensurePrivateFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
      throw new Error("backup_state_unsafe");
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      const handle = await open(path, "wx", 0o600);
      await handle.close();
    } else throw error;
  }
}

async function readPrivateFile(
  path: string,
  maximum: number,
): Promise<Buffer | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
      throw new Error("backup_state_unsafe");
    if (info.size > maximum) throw new Error("backup_state_too_large");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
