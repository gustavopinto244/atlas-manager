import { randomUUID } from "node:crypto";
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MachinePowerSchedulerCursorStore } from "../application/ports/machine-power-scheduler-cursor-store.js";
import {
  createMachinePowerSchedulerCursor,
  isSameMachinePowerSchedulerCursor,
  type MachinePowerSchedulerCursor,
} from "../domain/machine-power-scheduler-cursor.js";
import {
  createMachinePowerSchedulerCursorAdvanceResult,
  type MachinePowerSchedulerCursorAdvanceResult,
} from "../domain/machine-power-scheduler-cursor-result.js";

const VERSION = 1;
const MODE = 0o600;
export type FileMachinePowerSchedulerCursorStoreErrorCode =
  | "invalid_cursor_file"
  | "cursor_read_failed"
  | "cursor_write_failed"
  | "non_forward_cursor";
export class FileMachinePowerSchedulerCursorStoreError extends Error {
  public override readonly name = "FileMachinePowerSchedulerCursorStoreError";
  public constructor(
    public readonly code: FileMachinePowerSchedulerCursorStoreErrorCode,
  ) {
    super(`File machine power scheduler cursor store failed: ${code}`);
    Object.freeze(this);
  }
}
export interface FileMachinePowerSchedulerCursorFileHandle {
  writeFile(contents: string, options: { encoding: "utf8" }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface FileMachinePowerSchedulerCursorStoreDependencies {
  readFile(path: string): Promise<Uint8Array>;
  open(
    path: string,
    flags: "wx",
    mode: number,
  ): Promise<FileMachinePowerSchedulerCursorFileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  createTemporaryPath(path: string): string;
}
const defaults: FileMachinePowerSchedulerCursorStoreDependencies = {
  readFile: (path) => readFile(path),
  open: (path, flags, mode) => openFile(path, flags, mode),
  rename,
  unlink,
  createTemporaryPath: (path) =>
    join(dirname(path), `.atlas-machine-power-cursor.${randomUUID()}.tmp`),
};
export class FileMachinePowerSchedulerCursorStore implements MachinePowerSchedulerCursorStore {
  readonly #path: string;
  readonly #dependencies: FileMachinePowerSchedulerCursorStoreDependencies;
  #queue: Promise<void> = Promise.resolve();
  public constructor(path: string, dependencies = defaults) {
    this.#path = path;
    this.#dependencies = dependencies;
    Object.freeze(this);
  }
  public read(): Promise<MachinePowerSchedulerCursor | null> {
    return this.#enqueue(() => this.#read());
  }
  public advance(
    expected: MachinePowerSchedulerCursor | null,
    nextInput: MachinePowerSchedulerCursor,
  ): Promise<MachinePowerSchedulerCursorAdvanceResult> {
    return this.#enqueue(async () => {
      const current = await this.#read();
      const next = createMachinePowerSchedulerCursor(nextInput);
      if (!isSameMachinePowerSchedulerCursor(expected, current))
        return createMachinePowerSchedulerCursorAdvanceResult({
          kind: "conflict",
          cursor: current,
        });
      if (current && next.completedThrough <= current.completedThrough)
        throw new FileMachinePowerSchedulerCursorStoreError(
          "non_forward_cursor",
        );
      await this.#write(next);
      return createMachinePowerSchedulerCursorAdvanceResult({
        kind: "advanced",
        cursor: next,
      });
    });
  }
  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async #read(): Promise<MachinePowerSchedulerCursor | null> {
    let bytes: Uint8Array;
    try {
      bytes = await this.#dependencies.readFile(this.#path);
    } catch (error) {
      if (isMissing(error)) return null;
      throw new FileMachinePowerSchedulerCursorStoreError("cursor_read_failed");
    }
    return parse(bytes);
  }
  async #write(cursor: MachinePowerSchedulerCursor): Promise<void> {
    let temporary: string;
    try {
      temporary = this.#dependencies.createTemporaryPath(this.#path);
      if (
        temporary === this.#path ||
        dirname(temporary) !== dirname(this.#path)
      )
        throw new Error();
    } catch {
      throw new FileMachinePowerSchedulerCursorStoreError(
        "cursor_write_failed",
      );
    }
    let handle: FileMachinePowerSchedulerCursorFileHandle | undefined;
    let created = false;
    let closed = false;
    try {
      handle = await this.#dependencies.open(temporary, "wx", MODE);
      created = true;
      await handle.writeFile(
        `${JSON.stringify({ version: VERSION, completedThrough: cursor.completedThrough })}\n`,
        { encoding: "utf8" },
      );
      await handle.sync();
      await handle.close();
      closed = true;
      await this.#dependencies.rename(temporary, this.#path);
    } catch {
      if (handle && !closed)
        try {
          await handle.close();
        } catch {
          /* best effort */
        }
      if (created)
        try {
          await this.#dependencies.unlink(temporary);
        } catch {
          /* best effort */
        }
      throw new FileMachinePowerSchedulerCursorStoreError(
        "cursor_write_failed",
      );
    }
  }
}
function parse(bytes: Uint8Array): MachinePowerSchedulerCursor {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.endsWith("\n")) throw new Error();
    const parsed: unknown = JSON.parse(text);
    if (
      !isRecord(parsed) ||
      Reflect.ownKeys(parsed).length !== 2 ||
      parsed["version"] !== VERSION ||
      !Object.hasOwn(parsed, "completedThrough")
    )
      throw new Error();
    return createMachinePowerSchedulerCursor({
      completedThrough: parsed["completedThrough"],
    });
  } catch {
    throw new FileMachinePowerSchedulerCursorStoreError("invalid_cursor_file");
  }
}
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
