import type { BackupRun } from "../backup-management/domain/backup-run.js";
import type { BackupTarget } from "../backup-management/domain/backup-target.js";

export function mapBackupTarget(
  target: BackupTarget,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: target.id,
    displayName: target.displayName,
    kind: target.kind,
    scheduleMode: target.schedule.mode,
    retentionSummary: Object.freeze({
      keepLastSuccessful: target.retention.keepLastSuccessful,
      maxSuccessfulAgeDays: target.retention.maxSuccessfulAgeDays,
    }),
    capabilities: Object.freeze({
      manualRun: target.schedule.mode !== "disabled",
      schedule: target.schedule.mode !== "disabled",
      retention: true,
    }),
  });
}

export function mapBackupRun(
  run: BackupRun,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    sequence: run.sequence,
    runId: run.runId,
    targetId: run.targetId,
    trigger: run.trigger,
    scheduledFor: run.scheduledFor,
    requestedAt: run.requestedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status,
    ...(run.artifact === null
      ? {}
      : {
          fileCount: run.artifact.fileCount,
          totalBytes: run.artifact.totalBytes,
          manifestSha256: run.artifact.manifestSha256,
        }),
    ...(run.failureCode === null ? {} : { failureCode: run.failureCode }),
  });
}
