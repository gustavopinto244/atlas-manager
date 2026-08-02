import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isCanonicalTimestamp } from "../../power-management/domain/canonical-timestamp.js";
import { parseStrictJson } from "../../config/strict-json.js";

export type EventHistoryWriterLockInspection = Readonly<{
  state: "absent" | "busy" | "stale" | "invalid";
  ownerPid?: number;
}>;

export type EventHistoryWriterLockDependencies = Readonly<{
  processIsLive?: (pid: number) => boolean;
  processStartIdentity?: (pid: number) => string | undefined;
  currentProcessStartIdentity?: () => string;
  clock?: () => string;
  currentUserId?: () => number;
}>;

export class FileEventHistoryWriterLockError extends Error {
  public override readonly name = "FileEventHistoryWriterLockError";
  public constructor(
    public readonly code: "busy" | "stale" | "invalid" | "not_owner",
  ) {
    super(`Event-history writer lock failed: ${code}`);
    Object.freeze(this);
  }
}

export class FileEventHistoryWriterLock {
  readonly #path: string;
  readonly #dependencies: Required<EventHistoryWriterLockDependencies>;

  public constructor(
    path: string,
    dependencies: EventHistoryWriterLockDependencies = {},
  ) {
    if (
      !isAbsolute(path) ||
      path === "/" ||
      path.includes("\0") ||
      path.trim() !== path
    )
      throw new TypeError("Invalid event-history writer lock path");
    this.#path = path;
    this.#dependencies = {
      processIsLive: dependencies.processIsLive ?? defaultProcessIsLive,
      processStartIdentity:
        dependencies.processStartIdentity ?? readProcessStartIdentity,
      currentProcessStartIdentity:
        dependencies.currentProcessStartIdentity ??
        (() => readProcessStartIdentity(process.pid) ?? String(process.pid)),
      clock: dependencies.clock ?? (() => new Date().toISOString()),
      currentUserId: dependencies.currentUserId ?? defaultUserId,
    };
  }

  public inspect(): EventHistoryWriterLockInspection {
    if (!existsDirectory(this.#path)) return Object.freeze({ state: "absent" });
    try {
      const stats = lstatSync(this.#path);
      if (!stats.isDirectory() || stats.isSymbolicLink() || stats.nlink < 2)
        return Object.freeze({ state: "invalid" });
      const metadataStats = lstatSync(join(this.#path, "metadata.json"));
      if (
        !metadataStats.isFile() ||
        metadataStats.isSymbolicLink() ||
        metadataStats.nlink !== 1 ||
        metadataStats.uid !== this.#dependencies.currentUserId() ||
        (metadataStats.mode & 0o077) !== 0
      )
        return Object.freeze({ state: "invalid" });
      const metadata = parseLockMetadata(
        parseStrictJson(
          readFileSync(join(this.#path, "metadata.json"), "utf8"),
        ),
      );
      if (!this.#dependencies.processIsLive(metadata.ownerPid))
        return Object.freeze({ state: "stale", ownerPid: metadata.ownerPid });
      const start = this.#dependencies.processStartIdentity(metadata.ownerPid);
      if (start === undefined || start !== metadata.ownerProcessStart)
        return Object.freeze({ state: "stale", ownerPid: metadata.ownerPid });
      return Object.freeze({ state: "busy", ownerPid: metadata.ownerPid });
    } catch {
      return Object.freeze({ state: "invalid" });
    }
  }

  public acquire(operation: string): Readonly<{ token: string }> {
    const parent = dirname(this.#path);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    try {
      mkdirSync(this.#path, { mode: 0o700 });
    } catch {
      const state = this.inspect();
      throw new FileEventHistoryWriterLockError(
        state.state === "absent" ? "invalid" : state.state,
      );
    }
    const token = randomUUID();
    const metadata = {
      schemaVersion: 1,
      ownerPid: process.pid,
      ownerProcessStart: this.#dependencies.currentProcessStartIdentity(),
      operation,
      acquiredAt: this.#dependencies.clock(),
      ownerToken: token,
    };
    try {
      writeAtomic(
        join(this.#path, "metadata.json"),
        `${JSON.stringify(metadata)}\n`,
        0o600,
      );
      return Object.freeze({ token });
    } catch {
      rmSync(this.#path, { recursive: true, force: true });
      throw new FileEventHistoryWriterLockError("invalid");
    }
  }

  public release(token: string): void {
    try {
      const metadataStats = lstatSync(join(this.#path, "metadata.json"));
      if (
        !metadataStats.isFile() ||
        metadataStats.isSymbolicLink() ||
        metadataStats.nlink !== 1 ||
        metadataStats.uid !== this.#dependencies.currentUserId() ||
        (metadataStats.mode & 0o077) !== 0
      )
        throw new FileEventHistoryWriterLockError("invalid");
      const metadata = parseLockMetadata(
        parseStrictJson(
          readFileSync(join(this.#path, "metadata.json"), "utf8"),
        ),
      );
      if (metadata.ownerToken !== token)
        throw new FileEventHistoryWriterLockError("not_owner");
      rmSync(this.#path, { recursive: true, force: false });
      if (existsDirectory(this.#path))
        throw new FileEventHistoryWriterLockError("invalid");
    } catch (error) {
      if (error instanceof FileEventHistoryWriterLockError) throw error;
      throw new FileEventHistoryWriterLockError("invalid");
    }
  }
}

type LockMetadata = Readonly<{
  schemaVersion: 1;
  ownerPid: number;
  ownerProcessStart: string;
  operation: string;
  acquiredAt: string;
  ownerToken: string;
}>;

function parseLockMetadata(value: unknown): LockMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid");
  const record = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).length !== 6 ||
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.ownerPid) ||
    (record.ownerPid as number) <= 0 ||
    typeof record.ownerProcessStart !== "string" ||
    record.ownerProcessStart.length === 0 ||
    typeof record.operation !== "string" ||
    record.operation.length === 0 ||
    !isCanonicalTimestamp(record.acquiredAt) ||
    typeof record.ownerToken !== "string" ||
    !/^[0-9a-f-]{36}$/u.test(record.ownerToken)
  )
    throw new Error("invalid");
  return Object.freeze(record as unknown as LockMetadata);
}

function writeAtomic(path: string, content: string, mode: number): void {
  const candidate = `${path}.${randomUUID()}.candidate`;
  writeFileSync(candidate, content, { mode, flag: "wx" });
  const descriptor = openSync(candidate, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(candidate, path);
}

function existsDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function defaultProcessIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcessStartIdentity(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closing = stat.lastIndexOf(")");
    const fields = stat.slice(closing + 2).split(" ");
    return fields[19];
  } catch {
    return undefined;
  }
}

function defaultUserId(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}
