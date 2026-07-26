import { randomUUID } from "node:crypto";
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ServiceAvailabilityReconciliationOccurrenceClaimResult,
  ServiceAvailabilityReconciliationOccurrenceClaimStore,
} from "../application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import {
  isSameServiceAvailabilityReconciliationOccurrence,
  ServiceAvailabilityReconciliationOccurrence,
} from "../domain/service-availability-reconciliation-occurrence.js";

const CLAIM_FILE_VERSION = 1;
const TEMPORARY_FILE_MODE = 0o600;

const CLAIMED_RESULT = Object.freeze({
  kind: "claimed",
} as const satisfies ServiceAvailabilityReconciliationOccurrenceClaimResult);

const DUPLICATE_RESULT = Object.freeze({
  kind: "duplicate",
} as const satisfies ServiceAvailabilityReconciliationOccurrenceClaimResult);

export type FileServiceAvailabilityReconciliationOccurrenceClaimStoreErrorCode =
  "invalid_claim_file" | "claim_read_failed" | "claim_write_failed";

export class FileServiceAvailabilityReconciliationOccurrenceClaimStoreError extends Error {
  public override readonly name =
    "FileServiceAvailabilityReconciliationOccurrenceClaimStoreError";

  public constructor(
    public readonly code: FileServiceAvailabilityReconciliationOccurrenceClaimStoreErrorCode,
  ) {
    super(
      `File service availability reconciliation occurrence claim store failed: ${code}`,
    );
    Object.freeze(this);
  }
}

export interface FileServiceAvailabilityReconciliationOccurrenceClaimFileHandle {
  writeFile(
    contents: string,
    options: Readonly<{ encoding: "utf8" }>,
  ): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
  readonly open: (
    filePath: string,
    flags: "wx",
    mode: number,
  ) => Promise<FileServiceAvailabilityReconciliationOccurrenceClaimFileHandle>;
  readonly rename: (temporaryPath: string, filePath: string) => Promise<void>;
  readonly unlink: (filePath: string) => Promise<void>;
  readonly createTemporaryPath: (filePath: string) => string;
}

const defaultDependencies: FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies =
  Object.freeze({
    readFile: (filePath: string) => readFile(filePath),
    open: (filePath: string, flags: "wx", mode: number) =>
      openFile(filePath, flags, mode),
    rename,
    unlink,
    createTemporaryPath: (filePath: string) =>
      join(
        dirname(filePath),
        `.atlas-reconciliation-claims.${randomUUID()}.tmp`,
      ),
  });

export class FileServiceAvailabilityReconciliationOccurrenceClaimStore implements ServiceAvailabilityReconciliationOccurrenceClaimStore {
  readonly #filePath: string;
  readonly #dependencies: FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies;
  #operationQueue: Promise<void> = Promise.resolve();

  public constructor(
    filePath: string,
    dependencies: FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies = defaultDependencies,
  ) {
    this.#filePath = filePath;
    this.#dependencies = dependencies;
    Object.freeze(this);
  }

  public claim(
    occurrence: ServiceAvailabilityReconciliationOccurrence,
  ): Promise<ServiceAvailabilityReconciliationOccurrenceClaimResult> {
    return this.#enqueue(async () => {
      const currentClaims = await this.#readPersistedClaims();

      if (
        currentClaims.some((persistedOccurrence) =>
          isSameServiceAvailabilityReconciliationOccurrence(
            persistedOccurrence,
            occurrence,
          ),
        )
      ) {
        return DUPLICATE_RESULT;
      }

      const candidateClaims = [...currentClaims, occurrence].sort(
        compareOccurrences,
      );
      await this.#persistClaims(candidateClaims);
      return CLAIMED_RESULT;
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

  async #readPersistedClaims(): Promise<
    readonly ServiceAvailabilityReconciliationOccurrence[]
  > {
    let contents: Uint8Array;

    try {
      contents = await this.#dependencies.readFile(this.#filePath);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return Object.freeze([]);
      }

      throw new FileServiceAvailabilityReconciliationOccurrenceClaimStoreError(
        "claim_read_failed",
      );
    }

    return parseClaimFile(contents);
  }

  async #persistClaims(
    claims: readonly ServiceAvailabilityReconciliationOccurrence[],
  ): Promise<void> {
    let temporaryPath: string;

    try {
      temporaryPath = this.#dependencies.createTemporaryPath(this.#filePath);

      if (
        temporaryPath === this.#filePath ||
        dirname(temporaryPath) !== dirname(this.#filePath)
      ) {
        throw new Error("Temporary claim file must use the target directory");
      }
    } catch {
      throw new FileServiceAvailabilityReconciliationOccurrenceClaimStoreError(
        "claim_write_failed",
      );
    }

    let fileHandle:
      | FileServiceAvailabilityReconciliationOccurrenceClaimFileHandle
      | undefined;
    let temporaryFileCreated = false;
    let fileHandleClosed = false;

    try {
      fileHandle = await this.#dependencies.open(
        temporaryPath,
        "wx",
        TEMPORARY_FILE_MODE,
      );
      temporaryFileCreated = true;
      await fileHandle.writeFile(serializeClaimFile(claims), {
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

      throw new FileServiceAvailabilityReconciliationOccurrenceClaimStoreError(
        "claim_write_failed",
      );
    }
  }
}

function parseClaimFile(
  contents: Uint8Array,
): readonly ServiceAvailabilityReconciliationOccurrence[] {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    const parsed: unknown = JSON.parse(text);

    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 2 ||
      parsed.version !== CLAIM_FILE_VERSION ||
      !Array.isArray(parsed.claims)
    ) {
      throw new Error("Invalid claim file shape");
    }

    const claims: ServiceAvailabilityReconciliationOccurrence[] = [];

    for (const persistedClaim of parsed.claims) {
      if (
        !isRecord(persistedClaim) ||
        Object.keys(persistedClaim).length !== 3 ||
        !("serviceId" in persistedClaim) ||
        !("operation" in persistedClaim) ||
        !("scheduledFor" in persistedClaim)
      ) {
        throw new Error("Invalid persisted claim shape");
      }

      const occurrence = ServiceAvailabilityReconciliationOccurrence.create({
        serviceId: persistedClaim.serviceId as string,
        operation: persistedClaim.operation as string,
        scheduledFor: persistedClaim.scheduledFor as string,
      });

      if (
        claims.some((existing) =>
          isSameServiceAvailabilityReconciliationOccurrence(
            existing,
            occurrence,
          ),
        )
      ) {
        throw new Error("Duplicate persisted claim");
      }

      const previous = claims.at(-1);

      if (
        previous !== undefined &&
        compareOccurrences(previous, occurrence) >= 0
      ) {
        throw new Error("Persisted claims are not canonically ordered");
      }

      claims.push(occurrence);
    }

    return Object.freeze(claims);
  } catch {
    throw new FileServiceAvailabilityReconciliationOccurrenceClaimStoreError(
      "invalid_claim_file",
    );
  }
}

function serializeClaimFile(
  claims: readonly ServiceAvailabilityReconciliationOccurrence[],
): string {
  return `${JSON.stringify({
    version: CLAIM_FILE_VERSION,
    claims: claims.map(({ serviceId, operation, scheduledFor }) => ({
      serviceId,
      operation,
      scheduledFor,
    })),
  })}\n`;
}

function compareOccurrences(
  left: ServiceAvailabilityReconciliationOccurrence,
  right: ServiceAvailabilityReconciliationOccurrence,
): number {
  return (
    compareStrings(left.scheduledFor, right.scheduledFor) ||
    compareStrings(left.serviceId, right.serviceId) ||
    compareStrings(left.operation, right.operation)
  );
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
