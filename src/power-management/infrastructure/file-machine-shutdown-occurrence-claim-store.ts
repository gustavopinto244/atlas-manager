import { randomUUID } from "node:crypto";
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MachineShutdownOccurrenceClaimStore } from "../application/ports/machine-shutdown-occurrence-claim-store.js";
import {
  createMachineShutdownOccurrence,
  isSameMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "../domain/machine-shutdown-occurrence.js";
import {
  createMachineShutdownOccurrenceClaimResult,
  type MachineShutdownOccurrenceClaimResult,
} from "../domain/machine-shutdown-occurrence-claim-result.js";
import {
  createMachineShutdownOccurrenceClaimPruningResult,
  type MachineShutdownOccurrenceClaimPruningResult,
} from "../domain/machine-shutdown-occurrence-claim-pruning-result.js";
import type { MachinePowerSchedulerCursor } from "../domain/machine-power-scheduler-cursor.js";

const VERSION = 1;
const MODE = 0o600;
export type FileMachineShutdownOccurrenceClaimStoreErrorCode =
  "invalid_claim_file" | "claim_read_failed" | "claim_write_failed";
export class FileMachineShutdownOccurrenceClaimStoreError extends Error {
  public override readonly name =
    "FileMachineShutdownOccurrenceClaimStoreError";
  public constructor(
    public readonly code: FileMachineShutdownOccurrenceClaimStoreErrorCode,
  ) {
    super(`File machine shutdown occurrence claim store failed: ${code}`);
    Object.freeze(this);
  }
}
export interface FileMachineShutdownOccurrenceClaimFileHandle {
  writeFile(contents: string, options: { encoding: "utf8" }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface FileMachineShutdownOccurrenceClaimStoreDependencies {
  readFile(path: string): Promise<Uint8Array>;
  open(
    path: string,
    flags: "wx",
    mode: number,
  ): Promise<FileMachineShutdownOccurrenceClaimFileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  createTemporaryPath(path: string): string;
}
const defaults: FileMachineShutdownOccurrenceClaimStoreDependencies = {
  readFile: (path) => readFile(path),
  open: (path, flags, mode) => openFile(path, flags, mode),
  rename,
  unlink,
  createTemporaryPath: (path) =>
    join(dirname(path), `.atlas-machine-shutdown-claims.${randomUUID()}.tmp`),
};
export class FileMachineShutdownOccurrenceClaimStore implements MachineShutdownOccurrenceClaimStore {
  readonly #path: string;
  readonly #dependencies: FileMachineShutdownOccurrenceClaimStoreDependencies;
  #queue: Promise<void> = Promise.resolve();
  public constructor(path: string, dependencies = defaults) {
    this.#path = path;
    this.#dependencies = dependencies;
    Object.freeze(this);
  }
  public claim(
    input: MachineShutdownOccurrence,
  ): Promise<MachineShutdownOccurrenceClaimResult> {
    return this.#enqueue(async () => {
      const occurrence = createMachineShutdownOccurrence(input);
      const claims = await this.#read();
      if (
        claims.some((item) => isSameMachineShutdownOccurrence(item, occurrence))
      )
        return createMachineShutdownOccurrenceClaimResult({
          outcome: "duplicate",
        });
      const next = [...claims, occurrence].sort(compare);
      await this.#write(next);
      return createMachineShutdownOccurrenceClaimResult({ outcome: "claimed" });
    });
  }
  public pruneCompletedThrough(
    cursor: MachinePowerSchedulerCursor,
  ): Promise<MachineShutdownOccurrenceClaimPruningResult> {
    return this.#enqueue(async () => {
      const claims = await this.#read();
      const retained = claims.filter(
        (claim) => claim.scheduledFor > cursor.completedThrough,
      );
      if (retained.length === claims.length)
        return createMachineShutdownOccurrenceClaimPruningResult({
          outcome: "unchanged",
        });
      await this.#write(retained);
      return createMachineShutdownOccurrenceClaimPruningResult({
        outcome: "pruned",
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
  async #read(): Promise<readonly MachineShutdownOccurrence[]> {
    let bytes: Uint8Array;
    try {
      bytes = await this.#dependencies.readFile(this.#path);
    } catch (error) {
      if (isMissing(error)) return Object.freeze([]);
      throw new FileMachineShutdownOccurrenceClaimStoreError(
        "claim_read_failed",
      );
    }
    return parse(bytes);
  }
  async #write(claims: readonly MachineShutdownOccurrence[]): Promise<void> {
    let temporary: string;
    try {
      temporary = this.#dependencies.createTemporaryPath(this.#path);
      if (
        temporary === this.#path ||
        dirname(temporary) !== dirname(this.#path)
      )
        throw new Error();
    } catch {
      throw new FileMachineShutdownOccurrenceClaimStoreError(
        "claim_write_failed",
      );
    }
    let handle: FileMachineShutdownOccurrenceClaimFileHandle | undefined;
    let created = false;
    let closed = false;
    try {
      handle = await this.#dependencies.open(temporary, "wx", MODE);
      created = true;
      await handle.writeFile(
        `${JSON.stringify({ version: VERSION, claims })}\n`,
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
      throw new FileMachineShutdownOccurrenceClaimStoreError(
        "claim_write_failed",
      );
    }
  }
}
function parse(bytes: Uint8Array): readonly MachineShutdownOccurrence[] {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.endsWith("\n")) throw new Error();
    const parsed: unknown = JSON.parse(text);
    if (
      !isRecord(parsed) ||
      Reflect.ownKeys(parsed).length !== 2 ||
      parsed["version"] !== VERSION ||
      !Array.isArray(parsed["claims"])
    )
      throw new Error();
    const claims = parsed["claims"].map((raw) =>
      createMachineShutdownOccurrence(raw),
    );
    const sorted = [...claims].sort(compare);
    if (
      claims.some(
        (claim, index) =>
          index > 0 &&
          isSameMachineShutdownOccurrence(claim, claims[index - 1]!),
      ) ||
      claims.some((claim, index) => compare(claim, sorted[index]!) !== 0)
    )
      throw new Error();
    return Object.freeze(claims);
  } catch {
    throw new FileMachineShutdownOccurrenceClaimStoreError(
      "invalid_claim_file",
    );
  }
}
function compare(
  left: MachineShutdownOccurrence,
  right: MachineShutdownOccurrence,
): number {
  return (
    left.scheduledFor.localeCompare(right.scheduledFor) ||
    left.wakeScheduledFor.localeCompare(right.wakeScheduledFor) ||
    left.operation.localeCompare(right.operation)
  );
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
