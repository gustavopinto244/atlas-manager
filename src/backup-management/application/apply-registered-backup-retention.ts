import type {
  BackupClock,
  BackupOperationGate,
  BackupRunStore,
  BackupTargetCatalog,
} from "./ports/backup-ports.js";
import type { BackupRun } from "../domain/backup-run.js";

export interface ManagedBackupArtifact {
  readonly targetId: string;
  readonly runId: string;
  readonly completedAt: string;
  readonly manifestSha256: string;
}

export interface BackupArtifactStore {
  listManaged(targetId: string): Promise<readonly ManagedBackupArtifact[]>;
  removeManaged(targetId: string, runId: string): Promise<void>;
}

export interface BackupRetentionResult {
  readonly targetId: string;
  readonly processedCount: number;
  readonly deletedCount: number;
  readonly result: "completed" | "busy" | "blocked" | "partial";
}

export class ApplyRegisteredBackupRetention {
  readonly #catalog: BackupTargetCatalog;
  readonly #runs: BackupRunStore;
  readonly #artifacts: BackupArtifactStore;
  readonly #gate: BackupOperationGate;
  readonly #clock: BackupClock;

  public constructor(input: {
    readonly catalog: BackupTargetCatalog;
    readonly runs: BackupRunStore;
    readonly artifacts: BackupArtifactStore;
    readonly gate: BackupOperationGate;
    readonly clock: BackupClock;
  }) {
    this.#catalog = input.catalog;
    this.#runs = input.runs;
    this.#artifacts = input.artifacts;
    this.#gate = input.gate;
    this.#clock = input.clock;
    Object.freeze(this);
  }

  public async execute(targetId: string): Promise<BackupRetentionResult> {
    const target = this.#catalog.findById(targetId);
    if (target === null) throw new Error("registered_backup_target_not_found");
    const release = this.#gate.tryAcquire();
    if (release === undefined)
      return Object.freeze({
        targetId,
        processedCount: 0,
        deletedCount: 0,
        result: "busy",
      });
    try {
      const runs: BackupRun[] = [];
      let afterSequence = 0;
      for (;;) {
        const page = await this.#runs.query({
          targetId,
          status: "succeeded",
          afterSequence,
          limit: 100,
        });
        runs.push(...page.filter((run) => run.artifact !== null));
        if (page.length < 100) break;
        const last = page.at(-1);
        if (last === undefined || last.sequence <= afterSequence)
          throw new Error("backup_run_history_corrupt");
        afterSequence = last.sequence;
      }
      runs.sort(
        (left, right) =>
          Date.parse(right.completedAt ?? "") -
            Date.parse(left.completedAt ?? "") ||
          right.sequence - left.sequence,
      );
      const artifacts = await this.#artifacts.listManaged(targetId);
      const successful = new Map(runs.map((run) => [run.runId, run]));
      if (artifacts.some((artifact) => !successful.has(artifact.runId)))
        return Object.freeze({
          targetId,
          processedCount: artifacts.length,
          deletedCount: 0,
          result: "blocked",
        });
      const now = this.#clock.now().getTime();
      const protectedRunIds = new Set(
        runs
          .slice(0, target.retention.keepLastSuccessful)
          .map((run) => run.runId),
      );
      const deletion = artifacts
        .filter((artifact) => {
          if (protectedRunIds.has(artifact.runId)) return false;
          const tooOld =
            target.retention.maxSuccessfulAgeDays !== null &&
            now - new Date(artifact.completedAt).getTime() >
              target.retention.maxSuccessfulAgeDays * 86_400_000;
          return tooOld || runs.some((run) => run.runId === artifact.runId);
        })
        .sort(
          (left, right) =>
            Date.parse(left.completedAt) - Date.parse(right.completedAt) ||
            left.runId.localeCompare(right.runId),
        );
      let deletedCount = 0;
      for (const artifact of deletion) {
        try {
          await this.#artifacts.removeManaged(targetId, artifact.runId);
          deletedCount += 1;
        } catch {
          return Object.freeze({
            targetId,
            processedCount: artifacts.length,
            deletedCount,
            result: deletedCount === 0 ? "blocked" : "partial",
          });
        }
      }
      return Object.freeze({
        targetId,
        processedCount: artifacts.length,
        deletedCount,
        result: "completed",
      });
    } finally {
      release();
    }
  }
}
