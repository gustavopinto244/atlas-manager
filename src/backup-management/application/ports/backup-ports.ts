import type { BackupRun } from "../../domain/backup-run.js";
import type { BackupTarget } from "../../domain/backup-target.js";

export interface BackupTargetCatalog {
  list(): readonly BackupTarget[];
  findById(id: string): BackupTarget | null;
}

export interface BackupTargetPolicyStore {
  load(targets: readonly BackupTarget[]): readonly BackupTarget[];
  save(targets: readonly BackupTarget[]): void;
}

export interface BackupClock {
  now(): Date;
}

export interface BackupArtifactResult {
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly manifestSha256: string;
  readonly artifactDirectory: string;
}

export interface BackupAdapter {
  run(input: {
    readonly target: BackupTarget;
    readonly runId: string;
    readonly startedAt: string;
  }): Promise<BackupArtifactResult>;
}

export interface BackupRunStore {
  appendStarted(run: BackupRun): Promise<void>;
  appendTerminal(run: BackupRun): Promise<void>;
  getByRunId(runId: string): Promise<BackupRun | null>;
  query(input?: BackupRunQuery): Promise<readonly BackupRun[]>;
  reconstruct(): Promise<BackupRunStoreSnapshot>;
}

export interface BackupRunQuery {
  readonly afterSequence?: number;
  readonly limit?: number;
  readonly targetId?: string;
  readonly status?: BackupRun["status"];
  readonly trigger?: BackupRun["trigger"];
  readonly startedFrom?: string;
  readonly startedTo?: string;
}

export interface BackupRunStoreSnapshot {
  readonly runs: readonly BackupRun[];
  readonly active: boolean;
  readonly interrupted: readonly BackupRun[];
}

export interface BackupOperationGate {
  tryAcquire(): (() => void) | undefined;
  isActive(): boolean;
}

export interface BackupOccurrenceClaimStore {
  claim(
    targetId: string,
    scheduledFor: string,
  ): Promise<"claimed" | "duplicate">;
}

export interface BackupSchedulerCursorStore {
  read(): Promise<string | null>;
  compareAndSet(expected: string | null, next: string): Promise<boolean>;
}

export interface BackupReadiness {
  readonly state: "ready" | "active" | "interrupted" | "unavailable";
}

export interface BackupReadinessReader {
  read(): Promise<BackupReadiness>;
}
