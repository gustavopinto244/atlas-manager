import { randomUUID } from "node:crypto";
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createMachineOperatingPolicy,
  type MachineOperatingPolicy,
} from "../domain/machine-operating-policy.js";
import type { MachineOperatingPolicyStore } from "../application/ports/machine-operating-policy-store.js";

const FILE_VERSION = 1;
const TEMPORARY_FILE_MODE = 0o600;

export type FileMachineOperatingPolicyStoreErrorCode =
  "invalid_policy_file" | "policy_read_failed" | "policy_write_failed";

export class FileMachineOperatingPolicyStoreError extends Error {
  public override readonly name = "FileMachineOperatingPolicyStoreError";

  public constructor(
    public readonly code: FileMachineOperatingPolicyStoreErrorCode,
  ) {
    super(`File machine operating policy store failed: ${code}`);
    Object.freeze(this);
  }
}

interface FileHandle {
  writeFile(contents: string, options: { encoding: "utf8" }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface FileMachineOperatingPolicyStoreDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
  readonly open: (
    filePath: string,
    flags: "wx",
    mode: number,
  ) => Promise<FileHandle>;
  readonly rename: (temporaryPath: string, filePath: string) => Promise<void>;
  readonly unlink: (filePath: string) => Promise<void>;
  readonly createTemporaryPath: (filePath: string) => string;
}

const defaultDependencies: FileMachineOperatingPolicyStoreDependencies =
  Object.freeze({
    readFile: (filePath: string) => readFile(filePath),
    open: (filePath: string, flags: "wx", mode: number) =>
      openFile(filePath, flags, mode),
    rename,
    unlink,
    createTemporaryPath: (filePath: string) =>
      join(dirname(filePath), `.atlas-machine-policy.${randomUUID()}.tmp`),
  });

/**
 * Single-record, file-backed store for the declared machine operating
 * policy (ADR-033). It mirrors `FileServiceAvailabilityPolicyStore`'s
 * atomic write-rename shape and single in-process operation queue, but
 * holds at most one record instead of a keyed collection.
 */
export class FileMachineOperatingPolicyStore implements MachineOperatingPolicyStore {
  readonly #filePath: string;
  readonly #dependencies: FileMachineOperatingPolicyStoreDependencies;
  #operationQueue: Promise<void> = Promise.resolve();

  public constructor(filePath: string, dependencies = defaultDependencies) {
    this.#filePath = filePath;
    this.#dependencies = dependencies;
    Object.freeze(this);
  }

  public find(): Promise<MachineOperatingPolicy | null> {
    return this.#enqueue(() => this.#read());
  }

  public save(policy: MachineOperatingPolicy): Promise<void> {
    return this.#enqueue(() => this.#write(policy));
  }

  public remove(): Promise<void> {
    return this.#enqueue(() => this.#write(null));
  }

  async #read(): Promise<MachineOperatingPolicy | null> {
    let contents: Uint8Array;
    try {
      contents = await this.#dependencies.readFile(this.#filePath);
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw new FileMachineOperatingPolicyStoreError("policy_read_failed");
    }

    try {
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(contents),
      );
      if (
        !isRecord(parsed) ||
        Object.keys(parsed).length !== 2 ||
        parsed.version !== FILE_VERSION ||
        !Object.hasOwn(parsed, "policy")
      )
        throw new Error("invalid shape");
      if (parsed.policy === null) return null;
      return createMachineOperatingPolicy(parsed.policy);
    } catch {
      throw new FileMachineOperatingPolicyStoreError("invalid_policy_file");
    }
  }

  async #write(policy: MachineOperatingPolicy | null): Promise<void> {
    let temporaryPath: string;
    try {
      temporaryPath = this.#dependencies.createTemporaryPath(this.#filePath);
      if (
        temporaryPath === this.#filePath ||
        dirname(temporaryPath) !== dirname(this.#filePath)
      )
        throw new Error("invalid temporary path");
    } catch {
      throw new FileMachineOperatingPolicyStoreError("policy_write_failed");
    }

    let handle: FileHandle | undefined;
    let created = false;
    let closed = false;
    try {
      handle = await this.#dependencies.open(
        temporaryPath,
        "wx",
        TEMPORARY_FILE_MODE,
      );
      created = true;
      await handle.writeFile(
        `${JSON.stringify({
          version: FILE_VERSION,
          policy: policy === null ? null : serializePolicy(policy),
        })}\n`,
        { encoding: "utf8" },
      );
      await handle.sync();
      await handle.close();
      closed = true;
      await this.#dependencies.rename(temporaryPath, this.#filePath);
    } catch {
      if (handle !== undefined && !closed)
        await handle.close().catch(() => undefined);
      if (created)
        await this.#dependencies.unlink(temporaryPath).catch(() => undefined);
      throw new FileMachineOperatingPolicyStoreError("policy_write_failed");
    }
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationQueue.then(operation);
    this.#operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function serializePolicy(
  policy: MachineOperatingPolicy,
): Record<string, unknown> {
  return policy.mode === "scheduled"
    ? {
        mode: policy.mode,
        timezone: policy.timezone,
        weeklySchedule: policy.weeklySchedule,
      }
    : { mode: policy.mode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
