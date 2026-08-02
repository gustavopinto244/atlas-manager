import type {
  EventHistoryExportMetadata,
  EventHistoryRetentionPolicy,
} from "../event-history/domain/event-history-record.js";
import type {
  EventHistoryIntegrityResult,
  EventHistoryRetentionSummary,
} from "../event-history/application/ports/administrative-event-history-operations.js";

export function mapEventHistoryIntegrity(
  value: EventHistoryIntegrityResult,
): object {
  return Object.freeze({
    outcome: value.outcome,
    ...(value.earliestRetainedSequence === undefined
      ? {}
      : { earliestRetainedSequence: value.earliestRetainedSequence }),
    ...(value.latestSequence === undefined
      ? {}
      : { latestSequence: value.latestSequence }),
    ...(value.sealedSegmentCount === undefined
      ? {}
      : { sealedSegmentCount: value.sealedSegmentCount }),
    ...(value.activeSegmentEventCount === undefined
      ? {}
      : { activeSegmentEventCount: value.activeSegmentEventCount }),
    ...(value.retainedEventCount === undefined
      ? {}
      : { retainedEventCount: value.retainedEventCount }),
    ...(value.retentionAnchorPresent === undefined
      ? {}
      : { retentionAnchorPresent: value.retentionAnchorPresent }),
    ...(value.lastRecordSha256 === undefined
      ? {}
      : { lastRecordSha256: value.lastRecordSha256 }),
    ...(value.lastSegmentSha256 === undefined
      ? {}
      : { lastSegmentSha256: value.lastSegmentSha256 }),
    verifiedAt: value.verifiedAt,
  });
}

export function mapEventHistoryRetention(
  value: EventHistoryRetentionSummary,
): object {
  return Object.freeze({
    policy: mapPolicy(value.policy),
    earliestRetainedSequence: value.earliestRetainedSequence,
    latestSequence: value.latestSequence,
    sealedSegmentCount: value.sealedSegmentCount,
    retainedEventCount: value.retainedEventCount,
    eligibleSegmentCount: value.eligibleSegmentCount,
    exportCount: value.exportCount,
    eligibleExportCount: value.eligibleExportCount,
    automaticPruneEnabled: value.automaticPruneEnabled,
  });
}

export function mapEventHistoryPolicy(
  value: EventHistoryRetentionPolicy,
): object {
  return mapPolicy(value);
}

export function mapEventHistoryExport(
  value: EventHistoryExportMetadata,
): object {
  return Object.freeze({
    exportId: value.exportId,
    fromSequence: value.fromSequence,
    throughSequence: value.throughSequence,
    eventCount: value.eventCount,
    byteCount: value.byteCount,
    createdAt: value.createdAt,
    contentSha256: value.contentSha256,
  });
}

function mapPolicy(value: EventHistoryRetentionPolicy): object {
  return Object.freeze({
    automaticPruneEnabled: value.automaticPruneEnabled,
    segments: Object.freeze({ ...value.segments }),
    exports: Object.freeze({ ...value.exports }),
  });
}
