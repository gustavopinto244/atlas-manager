import { createHash } from "node:crypto";
import { isCanonicalTimestamp } from "../../power-management/domain/canonical-timestamp.js";
import {
  createAdministrativeEvent,
  type AdministrativeEvent,
} from "./administrative-event.js";
import { parseStrictJson } from "../../config/strict-json.js";

export const EVENT_HISTORY_RECORD_VERSION = 2 as const;
export const EVENT_HISTORY_GENESIS_SHA256 = "0".repeat(64);
export const EVENT_HISTORY_MAX_RECORD_BYTES = 64 * 1024;
export const EVENT_HISTORY_MAX_SEGMENT_EVENTS = 100_000;
export const EVENT_HISTORY_MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
export const EVENT_HISTORY_MAX_EXPORT_EVENTS = 100_000;
export const EVENT_HISTORY_MAX_EXPORT_BYTES = 128 * 1024 * 1024;

export type EventHistoryRecord = Readonly<{
  schemaVersion: 2;
  sequence: number;
  event: AdministrativeEvent;
  previousRecordSha256: string;
  recordSha256: string;
}>;

export type EventHistorySegmentManifest = Readonly<{
  schemaVersion: 1;
  firstSequence: number;
  lastSequence: number;
  eventCount: number;
  byteCount: number;
  firstRecordSha256: string;
  lastRecordSha256: string;
  previousSegmentSha256: string;
  segmentContentSha256: string;
  manifestSha256: string;
  sealedAt: string;
}>;

export type EventHistoryRetentionAnchor = Readonly<{
  schemaVersion: 1;
  retentionSequence: number;
  removedFirstSequence: number;
  removedLastSequence: number;
  removedEventCount: number;
  removedSegmentCount: number;
  removedFirstRecordSha256: string;
  removedLastRecordSha256: string;
  removedSegmentChainHead: string;
  nextRetainedSequence: number;
  nextRetainedPreviousRecordSha256: string;
  previousRetentionRecordSha256: string;
  retentionRecordSha256: string;
  prunedAt: string;
}>;

export type EventHistoryRetentionPolicy = Readonly<{
  schemaVersion: 1;
  automaticPruneEnabled: boolean;
  segments: Readonly<{
    minSealedSegments: number;
    maxSealedSegments: number;
    maxSealedSegmentAgeDays: number;
  }>;
  exports: Readonly<{
    minExports: number;
    maxExports: number;
    maxExportAgeDays: number;
  }>;
}>;

export type EventHistoryExportMetadata = Readonly<{
  schemaVersion: 1;
  exportId: string;
  fromSequence: number;
  throughSequence: number;
  eventCount: number;
  byteCount: number;
  contentSha256: string;
  createdAt: string;
  retentionAnchorSha256: string;
}>;

export const DEFAULT_EVENT_HISTORY_RETENTION_POLICY: EventHistoryRetentionPolicy =
  Object.freeze({
    schemaVersion: 1,
    automaticPruneEnabled: false,
    segments: Object.freeze({
      minSealedSegments: 1,
      maxSealedSegments: 100,
      maxSealedSegmentAgeDays: 365,
    }),
    exports: Object.freeze({
      minExports: 0,
      maxExports: 32,
      maxExportAgeDays: 90,
    }),
  });

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function serializeEventHistoryRecordForHash(
  record: Pick<
    EventHistoryRecord,
    "schemaVersion" | "sequence" | "event" | "previousRecordSha256"
  >,
): string {
  return canonicalJson({
    schemaVersion: record.schemaVersion,
    sequence: record.sequence,
    event: record.event,
    previousRecordSha256: record.previousRecordSha256,
  });
}

export function serializeEventHistoryRecord(
  record: EventHistoryRecord,
): string {
  return `${canonicalJson({
    schemaVersion: record.schemaVersion,
    sequence: record.sequence,
    event: record.event,
    previousRecordSha256: record.previousRecordSha256,
    recordSha256: record.recordSha256,
  })}\n`;
}

export function createEventHistoryRecord(input: unknown): EventHistoryRecord {
  const record = requireRecord(input);
  assertExactKeys(record, [
    "schemaVersion",
    "sequence",
    "event",
    "previousRecordSha256",
    "recordSha256",
  ]);
  if (record.schemaVersion !== EVENT_HISTORY_RECORD_VERSION)
    throw new Error("event_history_record_version_invalid");
  if (!isPositiveInteger(record.sequence))
    throw new Error("event_history_record_sequence_invalid");
  const event = createAdministrativeEvent(record.event);
  if (event.sequence !== record.sequence)
    throw new Error("event_history_record_sequence_mismatch");
  assertHash(record.previousRecordSha256);
  assertHash(record.recordSha256);
  const expected = sha256(
    serializeEventHistoryRecordForHash({
      schemaVersion: 2,
      sequence: record.sequence,
      event,
      previousRecordSha256: record.previousRecordSha256,
    }),
  );
  if (expected !== record.recordSha256)
    throw new Error("event_history_record_hash_invalid");
  return Object.freeze({
    schemaVersion: 2,
    sequence: record.sequence,
    event,
    previousRecordSha256: record.previousRecordSha256,
    recordSha256: record.recordSha256,
  });
}

export function createNextEventHistoryRecord(
  event: AdministrativeEvent,
  previousRecordSha256: string,
): EventHistoryRecord {
  assertHash(previousRecordSha256);
  const unsigned = {
    schemaVersion: 2 as const,
    sequence: event.sequence,
    event,
    previousRecordSha256,
  };
  return Object.freeze({
    ...unsigned,
    recordSha256: sha256(serializeEventHistoryRecordForHash(unsigned)),
  });
}

export function parseEventHistoryRecordLine(line: string): EventHistoryRecord {
  if (!line.endsWith("\n") || line.includes("\r"))
    throw new Error("event_history_record_line_invalid");
  const parsed = parseStrictJson(line.slice(0, -1));
  return createEventHistoryRecord(parsed);
}

export function serializeSegmentManifestForHash(
  manifest: Omit<EventHistorySegmentManifest, "manifestSha256">,
): string {
  return canonicalJson(manifest);
}

export function createSegmentManifest(
  input: Omit<EventHistorySegmentManifest, "manifestSha256">,
): EventHistorySegmentManifest {
  validateManifestInput(input);
  return Object.freeze({
    ...input,
    manifestSha256: sha256(serializeSegmentManifestForHash(input)),
  });
}

export function parseSegmentManifest(
  input: unknown,
): EventHistorySegmentManifest {
  const record = requireRecord(input);
  assertExactKeys(record, [
    "schemaVersion",
    "firstSequence",
    "lastSequence",
    "eventCount",
    "byteCount",
    "firstRecordSha256",
    "lastRecordSha256",
    "previousSegmentSha256",
    "segmentContentSha256",
    "manifestSha256",
    "sealedAt",
  ]);
  const withoutHash = {
    schemaVersion: record.schemaVersion,
    firstSequence: record.firstSequence,
    lastSequence: record.lastSequence,
    eventCount: record.eventCount,
    byteCount: record.byteCount,
    firstRecordSha256: record.firstRecordSha256,
    lastRecordSha256: record.lastRecordSha256,
    previousSegmentSha256: record.previousSegmentSha256,
    segmentContentSha256: record.segmentContentSha256,
    sealedAt: record.sealedAt,
  } as unknown as Omit<EventHistorySegmentManifest, "manifestSha256">;
  validateManifestInput(withoutHash);
  assertHash(record.manifestSha256);
  if (
    sha256(serializeSegmentManifestForHash(withoutHash)) !==
    record.manifestSha256
  )
    throw new Error("event_history_manifest_hash_invalid");
  return Object.freeze({
    ...withoutHash,
    manifestSha256: record.manifestSha256,
  });
}

export function createRetentionPolicy(
  input: unknown,
): EventHistoryRetentionPolicy {
  const record = requireRecord(input);
  assertExactKeys(record, [
    "schemaVersion",
    "automaticPruneEnabled",
    "segments",
    "exports",
  ]);
  const segments = requireRecord(record.segments);
  const exports = requireRecord(record.exports);
  assertExactKeys(segments, [
    "minSealedSegments",
    "maxSealedSegments",
    "maxSealedSegmentAgeDays",
  ]);
  assertExactKeys(exports, ["minExports", "maxExports", "maxExportAgeDays"]);
  if (
    record.schemaVersion !== 1 ||
    typeof record.automaticPruneEnabled !== "boolean"
  )
    throw new Error("event_history_retention_invalid");
  const policy = Object.freeze({
    schemaVersion: 1 as const,
    automaticPruneEnabled: record.automaticPruneEnabled,
    segments: Object.freeze({
      minSealedSegments: boundedInteger(segments.minSealedSegments, 1, 1_000),
      maxSealedSegments: boundedInteger(segments.maxSealedSegments, 1, 10_000),
      maxSealedSegmentAgeDays: boundedInteger(
        segments.maxSealedSegmentAgeDays,
        1,
        3_650,
      ),
    }),
    exports: Object.freeze({
      minExports: boundedInteger(exports.minExports, 0, 100),
      maxExports: boundedInteger(exports.maxExports, 1, 1_000),
      maxExportAgeDays: boundedInteger(exports.maxExportAgeDays, 1, 3_650),
    }),
  });
  if (
    policy.segments.maxSealedSegments < policy.segments.minSealedSegments ||
    policy.exports.maxExports < policy.exports.minExports
  )
    throw new Error("event_history_retention_invalid");
  return policy;
}

export function parseRetentionAnchor(
  input: unknown,
): EventHistoryRetentionAnchor {
  const record = requireRecord(input);
  assertExactKeys(record, [
    "schemaVersion",
    "retentionSequence",
    "removedFirstSequence",
    "removedLastSequence",
    "removedEventCount",
    "removedSegmentCount",
    "removedFirstRecordSha256",
    "removedLastRecordSha256",
    "removedSegmentChainHead",
    "nextRetainedSequence",
    "nextRetainedPreviousRecordSha256",
    "previousRetentionRecordSha256",
    "retentionRecordSha256",
    "prunedAt",
  ]);
  if (
    record.schemaVersion !== 1 ||
    !isPositiveInteger(record.retentionSequence) ||
    !isPositiveInteger(record.removedFirstSequence) ||
    !isPositiveInteger(record.removedLastSequence) ||
    record.removedLastSequence < record.removedFirstSequence ||
    !isPositiveInteger(record.removedEventCount) ||
    !isPositiveInteger(record.removedSegmentCount) ||
    !isPositiveInteger(record.nextRetainedSequence) ||
    record.nextRetainedSequence !== record.removedLastSequence + 1 ||
    !isCanonicalTimestamp(record.prunedAt)
  )
    throw new Error("event_history_retention_anchor_invalid");
  for (const key of [
    "removedFirstRecordSha256",
    "removedLastRecordSha256",
    "removedSegmentChainHead",
    "nextRetainedPreviousRecordSha256",
    "previousRetentionRecordSha256",
  ])
    assertHash(record[key]);
  const withoutHash = { ...record } as Record<string, unknown>;
  delete withoutHash.retentionRecordSha256;
  assertHash(record.retentionRecordSha256);
  if (sha256(canonicalJson(withoutHash)) !== record.retentionRecordSha256)
    throw new Error("event_history_retention_anchor_hash_invalid");
  return Object.freeze(record as unknown as EventHistoryRetentionAnchor);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function validateManifestInput(input: Record<string, unknown>): void {
  if (
    input.schemaVersion !== 1 ||
    !isPositiveInteger(input.firstSequence) ||
    !isPositiveInteger(input.lastSequence) ||
    input.lastSequence < input.firstSequence ||
    !isPositiveInteger(input.eventCount) ||
    input.eventCount !== input.lastSequence - input.firstSequence + 1 ||
    !isNonNegativeInteger(input.byteCount) ||
    !isCanonicalTimestamp(input.sealedAt)
  )
    throw new Error("event_history_manifest_invalid");
  for (const key of [
    "firstRecordSha256",
    "lastRecordSha256",
    "previousSegmentSha256",
    "segmentContentSha256",
  ])
    assertHash(input[key]);
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    throw new Error("event_history_retention_invalid");
  return value as number;
}

function assertHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
    throw new Error("event_history_hash_invalid");
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("event_history_record_invalid");
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("event_history_record_invalid");
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Reflect.ownKeys(record);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key))
  )
    throw new Error("event_history_record_fields_invalid");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortJson(record[key])]),
  );
}
