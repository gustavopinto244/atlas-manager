import type {
  EventHistoryExportMetadata,
  EventHistoryRetentionPolicy,
} from "../../domain/event-history-record.js";

export type EventHistoryIntegrityResult = Readonly<{
  outcome:
    | "verified"
    | "verified_with_retention"
    | "broken"
    | "interrupted"
    | "unavailable";
  earliestRetainedSequence?: number;
  latestSequence?: number;
  sealedSegmentCount?: number;
  activeSegmentEventCount?: number;
  retainedEventCount?: number;
  retentionAnchorPresent?: boolean;
  lastRecordSha256?: string;
  lastSegmentSha256?: string;
  verifiedAt: string;
}>;

export type EventHistoryRetentionSummary = Readonly<{
  policy: EventHistoryRetentionPolicy;
  earliestRetainedSequence: number;
  latestSequence: number;
  sealedSegmentCount: number;
  retainedEventCount: number;
  eligibleSegmentCount: number;
  exportCount: number;
  eligibleExportCount: number;
  automaticPruneEnabled: boolean;
}>;

export type EventHistoryRetentionResult = Readonly<{
  outcome: "unchanged" | "pruned" | "recovery_required" | "blocked";
  removedSegmentCount: number;
  removedEventCount: number;
}>;

export type EventHistoryExportRequest = Readonly<{
  fromSequence: number;
  throughSequence: number;
}>;

export type EventHistoryExportResult = Readonly<{
  outcome: "created" | "unchanged";
  metadata: EventHistoryExportMetadata;
}>;

export interface AdministrativeEventHistoryOperations {
  verifyIntegrity(): Promise<EventHistoryIntegrityResult>;
  rotate(): Promise<
    Readonly<{ outcome: "rotated" | "unchanged" | "recovery_required" }>
  >;
  getRetentionPolicy(): Promise<EventHistoryRetentionPolicy>;
  setRetentionPolicy(policy: unknown): Promise<EventHistoryRetentionPolicy>;
  getRetentionSummary(): Promise<EventHistoryRetentionSummary>;
  pruneSegments(): Promise<EventHistoryRetentionResult>;
  listExports(): Promise<readonly EventHistoryExportMetadata[]>;
  createExport(input: unknown): Promise<EventHistoryExportResult>;
  getExport(exportId: string): Promise<EventHistoryExportMetadata | undefined>;
  readExport(exportId: string): Promise<Buffer>;
  pruneExports(): Promise<
    Readonly<{
      outcome: "unchanged" | "pruned" | "blocked";
      removedExportCount: number;
    }>
  >;
}
