import { randomUUID } from "node:crypto";
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createServiceAvailabilityPolicy,
  type ServiceAvailabilityPolicy,
} from "../../service-scheduling/domain/service-availability-policy.js";
import type { ServiceAvailabilityPolicyStore } from "../application/ports/service-availability-policy-store.js";

const FILE_VERSION = 1;
const TEMPORARY_FILE_MODE = 0o600;

export type FileServiceAvailabilityPolicyStoreErrorCode =
  "invalid_policy_file" | "policy_read_failed" | "policy_write_failed";

export class FileServiceAvailabilityPolicyStoreError extends Error {
  public override readonly name = "FileServiceAvailabilityPolicyStoreError";

  public constructor(
    public readonly code: FileServiceAvailabilityPolicyStoreErrorCode,
  ) {
    super(`File service availability policy store failed: ${code}`);
    Object.freeze(this);
  }
}

interface FileHandle {
  writeFile(contents: string, options: { encoding: "utf8" }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface FileServiceAvailabilityPolicyStoreDependencies {
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

const defaultDependencies: FileServiceAvailabilityPolicyStoreDependencies =
  Object.freeze({
    readFile: (filePath: string) => readFile(filePath),
    open: (filePath: string, flags: "wx", mode: number) =>
      openFile(filePath, flags, mode),
    rename,
    unlink,
    createTemporaryPath: (filePath: string) =>
      join(dirname(filePath), `.atlas-service-policies.${randomUUID()}.tmp`),
  });

interface StoredPolicy {
  readonly serviceId: string;
  readonly policy: ServiceAvailabilityPolicy;
}

export class FileServiceAvailabilityPolicyStore implements ServiceAvailabilityPolicyStore {
  readonly #filePath: string;
  readonly #dependencies: FileServiceAvailabilityPolicyStoreDependencies;
  #operationQueue: Promise<void> = Promise.resolve();

  public constructor(filePath: string, dependencies = defaultDependencies) {
    this.#filePath = filePath;
    this.#dependencies = dependencies;
    Object.freeze(this);
  }

  public findByServiceId(
    serviceId: string,
  ): Promise<ServiceAvailabilityPolicy | null> {
    return this.#enqueue(async () => {
      const policies = await this.#read();
      return (
        policies.find((entry) => entry.serviceId === serviceId)?.policy ?? null
      );
    });
  }

  public findByServiceIds(
    serviceIds: readonly string[],
  ): Promise<ReadonlyMap<string, ServiceAvailabilityPolicy>> {
    return this.#enqueue(async () => {
      const requested = new Set(serviceIds);
      const policies = new Map<string, ServiceAvailabilityPolicy>();
      for (const entry of await this.#read()) {
        if (requested.has(entry.serviceId))
          policies.set(entry.serviceId, entry.policy);
      }
      return policies;
    });
  }

  public save(
    serviceId: string,
    policy: ServiceAvailabilityPolicy,
  ): Promise<void> {
    return this.#enqueue(async () => {
      const policies = (await this.#read())
        .filter((entry) => entry.serviceId !== serviceId)
        .concat({ serviceId, policy })
        .sort((left, right) => compare(left.serviceId, right.serviceId));
      await this.#write(policies);
    });
  }

  public removeByServiceId(serviceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const policies = (await this.#read()).filter(
        (entry) => entry.serviceId !== serviceId,
      );
      await this.#write(policies);
    });
  }

  async #read(): Promise<readonly StoredPolicy[]> {
    let contents: Uint8Array;
    try {
      contents = await this.#dependencies.readFile(this.#filePath);
    } catch (error) {
      if (isMissingFileError(error)) return Object.freeze([]);
      throw new FileServiceAvailabilityPolicyStoreError("policy_read_failed");
    }

    try {
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(contents),
      );
      if (
        !isRecord(parsed) ||
        Object.keys(parsed).length !== 2 ||
        parsed.version !== FILE_VERSION ||
        !Array.isArray(parsed.policies)
      )
        throw new Error("invalid shape");

      const policies = parsed.policies.map((entry): StoredPolicy => {
        if (
          !isRecord(entry) ||
          Object.keys(entry).length !== 2 ||
          typeof entry.serviceId !== "string" ||
          !Object.hasOwn(entry, "policy")
        )
          throw new Error("invalid entry");
        const policy = createServiceAvailabilityPolicy(entry.policy);
        return Object.freeze({ serviceId: entry.serviceId, policy });
      });

      for (let index = 1; index < policies.length; index += 1) {
        if (
          compare(policies[index - 1]!.serviceId, policies[index]!.serviceId) >=
          0
        )
          throw new Error("non-canonical entries");
      }
      return Object.freeze(policies);
    } catch {
      throw new FileServiceAvailabilityPolicyStoreError("invalid_policy_file");
    }
  }

  async #write(policies: readonly StoredPolicy[]): Promise<void> {
    let temporaryPath: string;
    try {
      temporaryPath = this.#dependencies.createTemporaryPath(this.#filePath);
      if (
        temporaryPath === this.#filePath ||
        dirname(temporaryPath) !== dirname(this.#filePath)
      )
        throw new Error("invalid temporary path");
    } catch {
      throw new FileServiceAvailabilityPolicyStoreError("policy_write_failed");
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
          policies: policies.map(({ serviceId, policy }) => ({
            serviceId,
            policy: serializePolicy(policy),
          })),
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
      throw new FileServiceAvailabilityPolicyStoreError("policy_write_failed");
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
  policy: ServiceAvailabilityPolicy,
): Record<string, unknown> {
  return policy.mode === "scheduled"
    ? {
        mode: policy.mode,
        timezone: policy.timezone,
        windows: policy.schedule.windows,
      }
    : { mode: policy.mode };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
