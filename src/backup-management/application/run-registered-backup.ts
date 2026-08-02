import { randomUUID } from "node:crypto";
import type {
  BackupAdapter,
  BackupClock,
  BackupOperationGate,
  BackupRunStore,
  BackupTargetCatalog,
} from "./ports/backup-ports.js";
import {
  completeBackupRun,
  createStartedBackupRun,
  type BackupRun,
} from "../domain/backup-run.js";

export interface RunRegisteredBackupInput {
  readonly targetId: string;
  readonly trigger: "manual" | "scheduled";
  readonly scheduledFor?: string;
}

export interface RunRegisteredBackupResult {
  readonly run: BackupRun;
  readonly artifactDirectory: string | null;
}

export class RunRegisteredBackup {
  readonly #catalog: BackupTargetCatalog;
  readonly #runStore: BackupRunStore;
  readonly #gate: BackupOperationGate;
  readonly #clock: BackupClock;
  readonly #adapters: Readonly<
    Record<"mock" | "filesystem_tree", BackupAdapter>
  >;

  public constructor(input: {
    readonly catalog: BackupTargetCatalog;
    readonly runStore: BackupRunStore;
    readonly gate: BackupOperationGate;
    readonly clock: BackupClock;
    readonly adapters: Readonly<
      Record<"mock" | "filesystem_tree", BackupAdapter>
    >;
  }) {
    this.#catalog = input.catalog;
    this.#runStore = input.runStore;
    this.#gate = input.gate;
    this.#clock = input.clock;
    this.#adapters = input.adapters;
    Object.freeze(this);
  }

  public async execute(
    input: RunRegisteredBackupInput,
  ): Promise<RunRegisteredBackupResult> {
    const target = this.#catalog.findById(input.targetId);
    if (target === null) throw new Error("registered_backup_target_not_found");
    if (target.schedule.mode === "disabled")
      throw new Error("backup_target_disabled");
    if (input.trigger === "scheduled" && target.schedule.mode !== "scheduled")
      throw new Error("backup_target_not_scheduled");
    const release = this.#gate.tryAcquire();
    if (release === undefined) throw new Error("backup_operation_busy");
    try {
      const requestedAt = this.#clock.now().toISOString();
      const startedAt = this.#clock.now().toISOString();
      const existing = await this.#runStore.query({ limit: 100 });
      const sequence =
        existing.length === 0
          ? 1
          : Math.max(...existing.map((run) => run.sequence)) + 1;
      const started = createStartedBackupRun({
        sequence,
        runId: randomUUID(),
        target,
        trigger: input.trigger,
        ...(input.scheduledFor === undefined
          ? {}
          : { scheduledFor: input.scheduledFor }),
        requestedAt,
        startedAt,
      });
      await this.#runStore.appendStarted(started);
      const adapter = this.#adapters[target.kind];
      try {
        const artifact = await adapter.run({
          target,
          runId: started.runId,
          startedAt,
        });
        const completed = completeBackupRun(
          started,
          {
            status: "succeeded",
            artifact: {
              fileCount: artifact.fileCount,
              totalBytes: artifact.totalBytes,
              manifestSha256: artifact.manifestSha256,
              completedAt: this.#clock.now().toISOString(),
            },
          },
          this.#clock.now().toISOString(),
        );
        await this.#runStore.appendTerminal(completed);
        return Object.freeze({
          run: completed,
          artifactDirectory: artifact.artifactDirectory,
        });
      } catch (error) {
        const failureCode = safeFailureCode(error);
        const failed = completeBackupRun(
          started,
          { status: "failed", failureCode },
          this.#clock.now().toISOString(),
        );
        await this.#runStore.appendTerminal(failed);
        throw Object.assign(new Error(failureCode), { run: failed });
      }
    } finally {
      release();
    }
  }
}

function safeFailureCode(error: unknown): string {
  if (error instanceof Error && /^backup_[a-z0-9_]+$/u.test(error.message))
    return error.message;
  return "backup_execution_failed";
}
