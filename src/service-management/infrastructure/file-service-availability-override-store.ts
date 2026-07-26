import { randomUUID } from "node:crypto";
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ServiceAvailabilityOverrideConditionalRemovalResult,
  ServiceAvailabilityOverrideStore,
} from "../application/ports/service-availability-override-store.js";
import {
  createServiceAvailabilityOverride,
  isSameServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../service-scheduling/domain/service-availability-override.js";

const OVERRIDE_FILE_VERSION = 1;
const TEMPORARY_FILE_MODE = 0o600;
const EARLIEST_REFERENCE_TIMESTAMP = -8_640_000_000_000_000;

const REMOVED_RESULT = Object.freeze({
  kind: "removed",
} as const satisfies ServiceAvailabilityOverrideConditionalRemovalResult);

const NOT_REMOVED_RESULT = Object.freeze({
  kind: "not_removed",
} as const satisfies ServiceAvailabilityOverrideConditionalRemovalResult);

export type FileServiceAvailabilityOverrideStoreErrorCode =
  "invalid_override_file" | "override_read_failed" | "override_write_failed";

export class FileServiceAvailabilityOverrideStoreError extends Error {
  public override readonly name = "FileServiceAvailabilityOverrideStoreError";

  public constructor(
    public readonly code: FileServiceAvailabilityOverrideStoreErrorCode,
  ) {
    super(`File service availability override store failed: ${code}`);
    Object.freeze(this);
  }
}

export interface FileServiceAvailabilityOverrideFileHandle {
  writeFile(
    contents: string,
    options: Readonly<{ encoding: "utf8" }>,
  ): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface FileServiceAvailabilityOverrideStoreDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
  readonly open: (
    filePath: string,
    flags: "wx",
    mode: number,
  ) => Promise<FileServiceAvailabilityOverrideFileHandle>;
  readonly rename: (temporaryPath: string, filePath: string) => Promise<void>;
  readonly unlink: (filePath: string) => Promise<void>;
  readonly createTemporaryPath: (filePath: string) => string;
}

const defaultDependencies: FileServiceAvailabilityOverrideStoreDependencies =
  Object.freeze({
    readFile: (filePath: string) => readFile(filePath),
    open: (filePath: string, flags: "wx", mode: number) =>
      openFile(filePath, flags, mode),
    rename,
    unlink,
    createTemporaryPath: (filePath: string) =>
      join(
        dirname(filePath),
        `.atlas-availability-overrides.${randomUUID()}.tmp`,
      ),
  });

interface StoredServiceAvailabilityOverride {
  readonly serviceId: string;
  readonly override: ServiceAvailabilityOverride;
}

export class FileServiceAvailabilityOverrideStore implements ServiceAvailabilityOverrideStore {
  readonly #filePath: string;
  readonly #dependencies: FileServiceAvailabilityOverrideStoreDependencies;
  #operationQueue: Promise<void> = Promise.resolve();

  public constructor(
    filePath: string,
    dependencies: FileServiceAvailabilityOverrideStoreDependencies = defaultDependencies,
  ) {
    this.#filePath = filePath;
    this.#dependencies = dependencies;
    Object.freeze(this);
  }

  public findByServiceId(
    serviceId: string,
  ): Promise<ServiceAvailabilityOverride | null> {
    return this.#enqueue(async () => {
      const currentOverrides = await this.#readPersistedOverrides();

      return (
        currentOverrides.find(
          (storedOverride) => storedOverride.serviceId === serviceId,
        )?.override ?? null
      );
    });
  }

  public save(
    serviceId: string,
    override: ServiceAvailabilityOverride,
  ): Promise<void> {
    return this.#enqueue(async () => {
      const currentOverrides = await this.#readPersistedOverrides();
      const candidateOverrides = currentOverrides
        .filter((storedOverride) => storedOverride.serviceId !== serviceId)
        .concat({ serviceId, override })
        .sort(compareStoredOverrides);

      await this.#persistOverrides(candidateOverrides);
    });
  }

  public removeByServiceId(serviceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const currentOverrides = await this.#readPersistedOverrides();
      const candidateOverrides = currentOverrides.filter(
        (storedOverride) => storedOverride.serviceId !== serviceId,
      );

      if (candidateOverrides.length === currentOverrides.length) {
        return;
      }

      await this.#persistOverrides(candidateOverrides);
    });
  }

  public removeByServiceIdIfMatches(
    serviceId: string,
    expectedOverride: ServiceAvailabilityOverride,
  ): Promise<ServiceAvailabilityOverrideConditionalRemovalResult> {
    return this.#enqueue(async () => {
      const currentOverrides = await this.#readPersistedOverrides();
      const currentOverride = currentOverrides.find(
        (storedOverride) => storedOverride.serviceId === serviceId,
      );

      if (
        currentOverride === undefined ||
        !isSameServiceAvailabilityOverride(
          currentOverride.override,
          expectedOverride,
        )
      ) {
        return NOT_REMOVED_RESULT;
      }

      const candidateOverrides = currentOverrides.filter(
        (storedOverride) => storedOverride.serviceId !== serviceId,
      );
      await this.#persistOverrides(candidateOverrides);
      return REMOVED_RESULT;
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationQueue.then(operation);
    this.#operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #readPersistedOverrides(): Promise<
    readonly StoredServiceAvailabilityOverride[]
  > {
    let contents: Uint8Array;

    try {
      contents = await this.#dependencies.readFile(this.#filePath);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return Object.freeze([]);
      }

      throw new FileServiceAvailabilityOverrideStoreError(
        "override_read_failed",
      );
    }

    return parseOverrideFile(contents);
  }

  async #persistOverrides(
    overrides: readonly StoredServiceAvailabilityOverride[],
  ): Promise<void> {
    let temporaryPath: string;

    try {
      temporaryPath = this.#dependencies.createTemporaryPath(this.#filePath);

      if (
        temporaryPath === this.#filePath ||
        dirname(temporaryPath) !== dirname(this.#filePath)
      ) {
        throw new Error(
          "Temporary override file must use the target directory",
        );
      }
    } catch {
      throw new FileServiceAvailabilityOverrideStoreError(
        "override_write_failed",
      );
    }

    let fileHandle: FileServiceAvailabilityOverrideFileHandle | undefined;
    let temporaryFileCreated = false;
    let fileHandleClosed = false;

    try {
      fileHandle = await this.#dependencies.open(
        temporaryPath,
        "wx",
        TEMPORARY_FILE_MODE,
      );
      temporaryFileCreated = true;
      await fileHandle.writeFile(serializeOverrideFile(overrides), {
        encoding: "utf8",
      });
      await fileHandle.sync();
      await fileHandle.close();
      fileHandleClosed = true;
      await this.#dependencies.rename(temporaryPath, this.#filePath);
    } catch {
      if (fileHandle !== undefined && !fileHandleClosed) {
        try {
          await fileHandle.close();
        } catch {
          // Best-effort resource release preserves the primary write failure.
        }
      }

      if (temporaryFileCreated) {
        try {
          await this.#dependencies.unlink(temporaryPath);
        } catch {
          // Best-effort cleanup preserves the primary write failure.
        }
      }

      throw new FileServiceAvailabilityOverrideStoreError(
        "override_write_failed",
      );
    }
  }
}

function parseOverrideFile(
  contents: Uint8Array,
): readonly StoredServiceAvailabilityOverride[] {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    const parsed: unknown = JSON.parse(text);

    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 2 ||
      parsed.version !== OVERRIDE_FILE_VERSION ||
      !Array.isArray(parsed.overrides)
    ) {
      throw new Error("Invalid override file shape");
    }

    const overrides: StoredServiceAvailabilityOverride[] = [];

    for (const persistedOverride of parsed.overrides) {
      if (
        !isRecord(persistedOverride) ||
        Object.keys(persistedOverride).length !== 3 ||
        !("serviceId" in persistedOverride) ||
        !("kind" in persistedOverride) ||
        !("expiresAt" in persistedOverride) ||
        typeof persistedOverride.serviceId !== "string"
      ) {
        throw new Error("Invalid persisted override shape");
      }

      const override = createServiceAvailabilityOverride(
        {
          kind: persistedOverride.kind,
          expiresAt: persistedOverride.expiresAt,
        },
        new Date(EARLIEST_REFERENCE_TIMESTAMP),
      );
      const previous = overrides.at(-1);

      if (
        previous !== undefined &&
        compareStrings(previous.serviceId, persistedOverride.serviceId) >= 0
      ) {
        throw new Error(
          "Persisted overrides are duplicated or not canonically ordered",
        );
      }

      overrides.push(
        Object.freeze({
          serviceId: persistedOverride.serviceId,
          override,
        }),
      );
    }

    return Object.freeze(overrides);
  } catch {
    throw new FileServiceAvailabilityOverrideStoreError(
      "invalid_override_file",
    );
  }
}

function serializeOverrideFile(
  overrides: readonly StoredServiceAvailabilityOverride[],
): string {
  return `${JSON.stringify({
    version: OVERRIDE_FILE_VERSION,
    overrides: overrides.map(({ serviceId, override }) => ({
      serviceId,
      kind: override.kind,
      expiresAt: override.expiresAt,
    })),
  })}\n`;
}

function compareStoredOverrides(
  left: StoredServiceAvailabilityOverride,
  right: StoredServiceAvailabilityOverride,
): number {
  return compareStrings(left.serviceId, right.serviceId);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
