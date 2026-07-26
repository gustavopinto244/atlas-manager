import { randomUUID } from "node:crypto";
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult,
  ServiceAvailabilityReconciliationSchedulerCursorStore,
} from "../application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import {
  isSameServiceAvailabilityReconciliationSchedulerCursor,
  ServiceAvailabilityReconciliationSchedulerCursor,
} from "../domain/service-availability-reconciliation-scheduler-cursor.js";

const CURSOR_FILE_VERSION = 1;
const TEMPORARY_FILE_MODE = 0o600;

export type FileServiceAvailabilityReconciliationSchedulerCursorStoreErrorCode =
  | "invalid_cursor_file"
  | "cursor_read_failed"
  | "cursor_write_failed"
  | "non_forward_cursor";

export class FileServiceAvailabilityReconciliationSchedulerCursorStoreError extends Error {
  public override readonly name =
    "FileServiceAvailabilityReconciliationSchedulerCursorStoreError";

  public constructor(
    public readonly code: FileServiceAvailabilityReconciliationSchedulerCursorStoreErrorCode,
  ) {
    super(
      `File service availability reconciliation scheduler cursor store failed: ${code}`,
    );
    Object.freeze(this);
  }
}

export interface FileServiceAvailabilityReconciliationSchedulerCursorFileHandle {
  writeFile(
    contents: string,
    options: Readonly<{ encoding: "utf8" }>,
  ): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
  readonly open: (
    filePath: string,
    flags: "wx",
    mode: number,
  ) => Promise<FileServiceAvailabilityReconciliationSchedulerCursorFileHandle>;
  readonly rename: (temporaryPath: string, filePath: string) => Promise<void>;
  readonly unlink: (filePath: string) => Promise<void>;
  readonly createTemporaryPath: (filePath: string) => string;
}

const defaultDependencies: FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies =
  Object.freeze({
    readFile: (filePath: string) => readFile(filePath),
    open: (filePath: string, flags: "wx", mode: number) =>
      openFile(filePath, flags, mode),
    rename,
    unlink,
    createTemporaryPath: (filePath: string) =>
      join(dirname(filePath), `.atlas-scheduler-cursor.${randomUUID()}.tmp`),
  });

export class FileServiceAvailabilityReconciliationSchedulerCursorStore implements ServiceAvailabilityReconciliationSchedulerCursorStore {
  readonly #filePath: string;
  readonly #dependencies: FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies;
  #operationQueue: Promise<void> = Promise.resolve();

  public constructor(
    filePath: string,
    dependencies: FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies = defaultDependencies,
  ) {
    this.#filePath = filePath;
    this.#dependencies = dependencies;
    Object.freeze(this);
  }

  public read(): Promise<ServiceAvailabilityReconciliationSchedulerCursor | null> {
    return this.#enqueue(() => this.#readPersistedCursor());
  }

  public advance(
    expected: ServiceAvailabilityReconciliationSchedulerCursor | null,
    next: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult> {
    return this.#enqueue(async () => {
      const current = await this.#readPersistedCursor();

      if (
        !isSameServiceAvailabilityReconciliationSchedulerCursor(
          expected,
          current,
        )
      ) {
        return Object.freeze({
          kind: "conflict",
          cursor: current,
        });
      }

      if (
        current !== null &&
        next.completedThrough <= current.completedThrough
      ) {
        throw new FileServiceAvailabilityReconciliationSchedulerCursorStoreError(
          "non_forward_cursor",
        );
      }

      await this.#persistCursor(next);

      return Object.freeze({
        kind: "advanced",
        cursor: next,
      });
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

  async #readPersistedCursor(): Promise<ServiceAvailabilityReconciliationSchedulerCursor | null> {
    let contents: Uint8Array;

    try {
      contents = await this.#dependencies.readFile(this.#filePath);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw new FileServiceAvailabilityReconciliationSchedulerCursorStoreError(
        "cursor_read_failed",
      );
    }

    return parseCursorFile(contents);
  }

  async #persistCursor(
    cursor: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<void> {
    let temporaryPath: string;

    try {
      temporaryPath = this.#dependencies.createTemporaryPath(this.#filePath);

      if (
        temporaryPath === this.#filePath ||
        dirname(temporaryPath) !== dirname(this.#filePath)
      ) {
        throw new Error("Temporary cursor file must use the target directory");
      }
    } catch {
      throw new FileServiceAvailabilityReconciliationSchedulerCursorStoreError(
        "cursor_write_failed",
      );
    }

    let fileHandle:
      | FileServiceAvailabilityReconciliationSchedulerCursorFileHandle
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
      await fileHandle.writeFile(serializeCursor(cursor), {
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

      throw new FileServiceAvailabilityReconciliationSchedulerCursorStoreError(
        "cursor_write_failed",
      );
    }
  }
}

function parseCursorFile(
  contents: Uint8Array,
): ServiceAvailabilityReconciliationSchedulerCursor {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    const parsed: unknown = JSON.parse(text);

    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 2 ||
      parsed.version !== CURSOR_FILE_VERSION ||
      typeof parsed.completedThrough !== "string"
    ) {
      throw new Error("Invalid cursor file shape");
    }

    return ServiceAvailabilityReconciliationSchedulerCursor.create({
      completedThrough: parsed.completedThrough,
    });
  } catch {
    throw new FileServiceAvailabilityReconciliationSchedulerCursorStoreError(
      "invalid_cursor_file",
    );
  }
}

function serializeCursor(
  cursor: ServiceAvailabilityReconciliationSchedulerCursor,
): string {
  return `${JSON.stringify({
    version: CURSOR_FILE_VERSION,
    completedThrough: cursor.completedThrough,
  })}\n`;
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
