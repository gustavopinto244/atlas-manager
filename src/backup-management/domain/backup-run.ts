import type { BackupTarget } from "./backup-target.js";

export const BACKUP_TRIGGERS = Object.freeze(["manual", "scheduled"] as const);
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];
export const BACKUP_RUN_STATUSES = Object.freeze([
  "started",
  "succeeded",
  "failed",
  "interrupted",
] as const);
export type BackupRunStatus = (typeof BACKUP_RUN_STATUSES)[number];

export interface BackupArtifactSummary {
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly manifestSha256: string;
  readonly completedAt: string;
}

export interface BackupRun {
  readonly sequence: number;
  readonly runId: string;
  readonly targetId: string;
  readonly trigger: BackupTrigger;
  readonly scheduledFor: string | null;
  readonly requestedAt: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly status: BackupRunStatus;
  readonly artifact: BackupArtifactSummary | null;
  readonly failureCode: string | null;
}

export function createStartedBackupRun(input: {
  readonly sequence: number;
  readonly runId: string;
  readonly target: BackupTarget;
  readonly trigger: BackupTrigger;
  readonly scheduledFor?: string;
  readonly requestedAt: string;
  readonly startedAt: string;
}): BackupRun {
  return Object.freeze({
    sequence: input.sequence,
    runId: input.runId,
    targetId: input.target.id,
    trigger: input.trigger,
    scheduledFor: input.scheduledFor ?? null,
    requestedAt: input.requestedAt,
    startedAt: input.startedAt,
    completedAt: null,
    status: "started",
    artifact: null,
    failureCode: null,
  });
}

export function completeBackupRun(
  started: BackupRun,
  input:
    | { readonly status: "succeeded"; readonly artifact: BackupArtifactSummary }
    | {
        readonly status: "failed" | "interrupted";
        readonly failureCode: string;
      },
  completedAt: string,
): BackupRun {
  if (started.status !== "started") throw new Error("backup_run_not_started");
  return Object.freeze({
    ...started,
    completedAt,
    status: input.status,
    artifact:
      input.status === "succeeded" ? Object.freeze(input.artifact) : null,
    failureCode: input.status === "succeeded" ? null : input.failureCode,
  });
}
