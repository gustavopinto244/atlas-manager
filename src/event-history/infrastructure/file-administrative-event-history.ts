import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import {
  createAdministrativeEvent,
  createAdministrativeEventInput,
  type AdministrativeEvent,
  type AdministrativeEventInput,
} from "../domain/administrative-event.js";
import { createAdministrativeEventHistoryPage } from "../domain/administrative-event-history-page.js";
import {
  createAdministrativeEventHistoryQuery,
  type AdministrativeEventHistoryQuery,
} from "../domain/administrative-event-history-query.js";
import type { AdministrativeEventRecorder } from "../application/ports/administrative-event-recorder.js";
import type { AdministrativeEventHistoryPage } from "../domain/administrative-event-history-page.js";
import type {
  AdministrativeEventHistoryReadinessReader,
  AdministrativeEventHistoryReadinessResult,
  AdministrativeEventHistoryReader,
} from "../application/ports/administrative-event-history-reader.js";

export const ADMINISTRATIVE_EVENT_HISTORY_FILE_VERSION = 1 as const;
export const ADMINISTRATIVE_EVENT_HISTORY_MAX_LINE_BYTES = 8_192;
export const ADMINISTRATIVE_EVENT_HISTORY_MAX_FILE_BYTES = 16 * 1024 * 1024;

export type FileAdministrativeEventHistoryErrorCode =
  | "event_history_path_invalid"
  | "event_history_parent_invalid"
  | "event_history_file_invalid"
  | "event_history_permissions_unsafe"
  | "event_history_read_failed"
  | "event_history_write_failed"
  | "event_history_sync_failed"
  | "event_history_corrupted"
  | "event_history_capacity_exceeded";

export class FileAdministrativeEventHistoryError extends Error {
  public override readonly name = "FileAdministrativeEventHistoryError";
  public constructor(
    public readonly code: FileAdministrativeEventHistoryErrorCode,
  ) {
    super(`File administrative event history failed: ${code}`);
    Object.freeze(this);
  }
}

export interface FileAdministrativeEventHistoryDependencies {
  readonly currentUserId?: () => number;
}

export class FileAdministrativeEventHistory
  implements
    AdministrativeEventRecorder,
    AdministrativeEventHistoryReader,
    AdministrativeEventHistoryReadinessReader
{
  readonly #filePath: string;
  readonly #currentUserId: () => number;
  #tail: Promise<void> = Promise.resolve();

  public constructor(
    filePath: string,
    dependencies: FileAdministrativeEventHistoryDependencies = {},
  ) {
    validateConfiguredPath(filePath);
    this.#filePath = filePath;
    this.#currentUserId = dependencies.currentUserId ?? defaultCurrentUserId;
    Object.freeze(this);
  }

  public record(input: AdministrativeEventInput): Promise<AdministrativeEvent> {
    const validated = createAdministrativeEventInput(input);
    const operation = this.#tail.then(
      () => this.#recordOne(validated),
      () => this.#recordOne(validated),
    );
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public query(input?: unknown): Promise<AdministrativeEventHistoryPage> {
    const query = createAdministrativeEventHistoryQuery(input);
    const operation = this.#tail.then(
      () => this.#queryOne(query),
      () => this.#queryOne(query),
    );
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public check(): Promise<AdministrativeEventHistoryReadinessResult> {
    const operation = this.#tail.then(() => {
      try {
        const reconstructed = this.#reconstruct();
        if (reconstructed.bytes >= ADMINISTRATIVE_EVENT_HISTORY_MAX_FILE_BYTES)
          return Object.freeze({
            outcome: "unavailable" as const,
            code: "event_history_unavailable" as const,
          });
        return Object.freeze({ outcome: "ready" as const });
      } catch (error) {
        return Object.freeze({
          outcome: "unavailable" as const,
          code:
            error instanceof FileAdministrativeEventHistoryError &&
            error.code === "event_history_corrupted"
              ? ("event_history_corrupted" as const)
              : ("event_history_unavailable" as const),
        });
      }
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  #recordOne(input: AdministrativeEventInput): AdministrativeEvent {
    const reconstructed = this.#reconstruct();
    const event = createAdministrativeEvent({
      sequence: reconstructed.events.length + 1,
      ...input,
    });
    const line = serializeEventLine(event);
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > ADMINISTRATIVE_EVENT_HISTORY_MAX_LINE_BYTES)
      throw new FileAdministrativeEventHistoryError(
        "event_history_capacity_exceeded",
      );
    if (
      reconstructed.bytes + lineBytes >
      ADMINISTRATIVE_EVENT_HISTORY_MAX_FILE_BYTES
    )
      throw new FileAdministrativeEventHistoryError(
        "event_history_capacity_exceeded",
      );
    validateParent(this.#filePath, this.#currentUserId());
    let descriptor: number | undefined;
    let failure: FileAdministrativeEventHistoryError | undefined;
    try {
      descriptor = openSync(
        this.#filePath,
        constants.O_WRONLY |
          constants.O_APPEND |
          constants.O_CREAT |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      const stats = fstatSync(descriptor);
      validateExistingFile(stats, this.#currentUserId());
      writeComplete(descriptor, Buffer.from(line, "utf8"));
    } catch (error) {
      failure =
        error instanceof FileAdministrativeEventHistoryError
          ? error
          : new FileAdministrativeEventHistoryError(
              "event_history_write_failed",
            );
    }
    let syncFailed = false;
    let closeFailed = false;
    if (descriptor !== undefined) {
      try {
        fsyncSync(descriptor);
      } catch {
        syncFailed = true;
      }
      try {
        closeSync(descriptor);
      } catch {
        closeFailed = true;
      }
    }
    if (failure) throw failure;
    if (syncFailed)
      throw new FileAdministrativeEventHistoryError(
        "event_history_sync_failed",
      );
    if (closeFailed)
      throw new FileAdministrativeEventHistoryError(
        "event_history_write_failed",
      );
    return createAdministrativeEvent(event);
  }

  #queryOne(
    query: AdministrativeEventHistoryQuery,
  ): AdministrativeEventHistoryPage {
    const reconstructed = this.#reconstruct();
    const matches = reconstructed.events.filter((event) =>
      matchesQuery(event, query),
    );
    return createAdministrativeEventHistoryPage({
      events: matches
        .slice(0, query.limit)
        .map((event) => createAdministrativeEvent(event)),
      hasMore: matches.length > query.limit,
    });
  }

  #reconstruct(): {
    readonly events: readonly AdministrativeEvent[];
    readonly bytes: number;
  } {
    validateParent(this.#filePath, this.#currentUserId());
    let stats: Stats;
    try {
      stats = lstatSync(this.#filePath);
    } catch (error) {
      if (isNotFound(error)) return { events: [], bytes: 0 };
      throw new FileAdministrativeEventHistoryError(
        "event_history_read_failed",
      );
    }
    validateExistingFile(stats, this.#currentUserId());
    let content: Buffer;
    try {
      content = readFileSync(this.#filePath);
    } catch {
      throw new FileAdministrativeEventHistoryError(
        "event_history_read_failed",
      );
    }
    if (content.byteLength > ADMINISTRATIVE_EVENT_HISTORY_MAX_FILE_BYTES)
      throw new FileAdministrativeEventHistoryError(
        "event_history_capacity_exceeded",
      );
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new FileAdministrativeEventHistoryError("event_history_corrupted");
    }
    if (content.byteLength === 0) return { events: [], bytes: 0 };
    if (
      text.charCodeAt(0) === 0xfeff ||
      !text.endsWith("\n") ||
      text.includes("\r")
    )
      throw new FileAdministrativeEventHistoryError("event_history_corrupted");
    const lines = text.split("\n");
    lines.pop();
    if (lines.some((line) => line.length === 0 || line !== line.trim()))
      throw new FileAdministrativeEventHistoryError("event_history_corrupted");
    const events: AdministrativeEvent[] = [];
    let expectedSequence = 1;
    const attemptStatuses = new Map<string, readonly string[]>();
    for (const line of lines) {
      if (
        Buffer.byteLength(`${line}\n`, "utf8") >
        ADMINISTRATIVE_EVENT_HISTORY_MAX_LINE_BYTES
      )
        throw new FileAdministrativeEventHistoryError(
          "event_history_capacity_exceeded",
        );
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        throw new FileAdministrativeEventHistoryError(
          "event_history_corrupted",
        );
      }
      if (
        !isRecord(parsed) ||
        parsed["version"] !== ADMINISTRATIVE_EVENT_HISTORY_FILE_VERSION
      )
        throw new FileAdministrativeEventHistoryError(
          "event_history_corrupted",
        );
      let event: AdministrativeEvent;
      try {
        event = createAdministrativeEvent(removeVersion(parsed));
      } catch {
        throw new FileAdministrativeEventHistoryError(
          "event_history_corrupted",
        );
      }
      if (
        event.sequence !== expectedSequence ||
        serializeEventLine(event).slice(0, -1) !== line
      )
        throw new FileAdministrativeEventHistoryError(
          "event_history_corrupted",
        );
      const prior = attemptStatuses.get(event.attemptId) ?? [];
      const isSingleAuthorizationEvent =
        event.operation === "authorize_administrative_operation" &&
        (event.status === "succeeded" || event.status === "rejected");
      if (
        prior.length > 1 ||
        (prior.length === 0 &&
          event.status !== "started" &&
          !isSingleAuthorizationEvent) ||
        (prior.length === 1 && event.status === "started")
      )
        throw new FileAdministrativeEventHistoryError(
          "event_history_corrupted",
        );
      attemptStatuses.set(event.attemptId, [...prior, event.status]);
      events.push(event);
      expectedSequence += 1;
    }
    return { events: Object.freeze(events), bytes: content.byteLength };
  }
}

function serializeEventLine(event: AdministrativeEvent): string {
  return `${JSON.stringify({ version: 1, ...event })}\n`;
}

function removeVersion(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const event = { ...record };
  delete event["version"];
  return event;
}

function validateConfiguredPath(filePath: string): void {
  if (
    typeof filePath !== "string" ||
    !isAbsolute(filePath) ||
    filePath === "/" ||
    filePath.trim() !== filePath ||
    [...filePath].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  )
    throw new FileAdministrativeEventHistoryError("event_history_path_invalid");
}

function validateParent(filePath: string, currentUserId: number): void {
  let stats: Stats;
  try {
    stats = lstatSync(dirname(filePath));
  } catch {
    throw new FileAdministrativeEventHistoryError(
      "event_history_parent_invalid",
    );
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    stats.uid !== currentUserId ||
    (stats.mode & 0o222) !== 0o200
  )
    throw new FileAdministrativeEventHistoryError(
      "event_history_parent_invalid",
    );
}

function validateExistingFile(stats: Stats, currentUserId: number): void {
  if (stats.isSymbolicLink() || !stats.isFile())
    throw new FileAdministrativeEventHistoryError("event_history_file_invalid");
  if (stats.uid !== currentUserId)
    throw new FileAdministrativeEventHistoryError(
      "event_history_permissions_unsafe",
    );
  if ((stats.mode & 0o077) !== 0)
    throw new FileAdministrativeEventHistoryError(
      "event_history_permissions_unsafe",
    );
}

function writeComplete(descriptor: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.byteLength)
    offset += writeSync(descriptor, content, offset);
}

function defaultCurrentUserId(): number {
  return typeof process.getuid === "function" ? process.getuid() : -1;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function matchesQuery(
  event: AdministrativeEvent,
  query: AdministrativeEventHistoryQuery,
): boolean {
  return (
    event.sequence > query.afterSequence &&
    (query.source === undefined || event.source.kind === query.source) &&
    (query.operation === undefined || event.operation === query.operation) &&
    (query.status === undefined || event.status === query.status) &&
    (query.attemptId === undefined || event.attemptId === query.attemptId) &&
    (query.occurredFrom === undefined ||
      event.occurredAt >= query.occurredFrom) &&
    (query.occurredTo === undefined || event.occurredAt < query.occurredTo)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
