import type { BackupRun, BackupTrigger } from "../domain/backup-run.js";
import {
  createBackupSchedule,
  createRetention,
  type BackupSchedule,
  type BackupRetentionPolicy,
  type BackupTarget,
  BACKUP_DESTINATION_ROOT,
} from "../domain/backup-target.js";
import {
  ApplyRegisteredBackupRetention,
  type BackupRetentionResult,
} from "../application/apply-registered-backup-retention.js";
import { FixedBackupOperationGate } from "../application/backup-operation-gate.js";
import type { BackupArtifactStore } from "../application/apply-registered-backup-retention.js";
import type {
  BackupAdapter,
  BackupClock,
  BackupOccurrenceClaimStore,
  BackupRunQuery,
  BackupRunStore,
  BackupSchedulerCursorStore,
  BackupTargetPolicyStore,
} from "../application/ports/backup-ports.js";
import {
  RunBackupSchedulerTick,
  type BackupSchedulerTickResult,
} from "../application/run-backup-scheduler-tick.js";
import {
  RunRegisteredBackup,
  type RunRegisteredBackupResult,
} from "../application/run-registered-backup.js";
import { FilesystemTreeBackupAdapter } from "../infrastructure/filesystem-tree-backup-adapter.js";
import { InMemoryBackupTargetCatalog } from "../infrastructure/in-memory-backup-target-catalog.js";
import {
  InMemoryBackupOccurrenceClaimStore,
  InMemoryBackupSchedulerCursorStore,
} from "../infrastructure/in-memory-backup-scheduler-state.js";
import { MockBackupAdapter } from "../infrastructure/mock-backup-adapter.js";
import { InMemoryBackupRunStore } from "../infrastructure/in-memory-backup-run-store.js";
import { FilesystemBackupArtifactStore } from "../infrastructure/filesystem-backup-artifact-store.js";
import {
  FileBackupOccurrenceClaimStore,
  FileBackupSchedulerCursorStore,
} from "../infrastructure/file-backup-scheduler-state.js";
import { FileBackupTargetPolicyStore } from "../infrastructure/file-backup-target-policy-store.js";

export interface BackupManagementCapabilities {
  listRegisteredBackupTargets(): readonly BackupTarget[];
  getRegisteredBackupTarget(targetId: string): BackupTarget | null;
  getBackupRuns(query?: BackupRunQuery): Promise<readonly BackupRun[]>;
  getBackupRun(runId: string): Promise<BackupRun | null>;
  runRegisteredBackup(input: {
    readonly targetId: string;
    readonly trigger: BackupTrigger;
    readonly scheduledFor?: string;
  }): Promise<RunRegisteredBackupResult>;
  getBackupSchedule(targetId: string): BackupSchedule;
  setBackupSchedule(targetId: string, input: unknown): BackupSchedule;
  removeBackupSchedule(targetId: string): BackupSchedule;
  getBackupRetention(targetId: string): BackupRetentionPolicy;
  setBackupRetention(targetId: string, input: unknown): BackupRetentionPolicy;
  pruneBackupRetention(targetId: string): Promise<BackupRetentionResult>;
  runBackupSchedulerTick(): Promise<BackupSchedulerTickResult>;
  readonly readiness: {
    read(): Promise<{
      readonly state: "ready" | "active" | "interrupted" | "unavailable";
    }>;
  };
}

export interface BackupManagementCompositionInput {
  readonly targets: readonly BackupTarget[];
  readonly clock?: BackupClock;
  readonly runStore?: BackupRunStore;
  readonly destinationRoot?: string;
  readonly adapters?: Partial<
    Readonly<Record<"mock" | "filesystem_tree", BackupAdapter>>
  >;
  readonly claims?: BackupOccurrenceClaimStore;
  readonly cursor?: BackupSchedulerCursorStore;
  readonly artifacts?: BackupArtifactStore;
  readonly occurrenceClaimFile?: string;
  readonly schedulerCursorFile?: string;
  readonly policyStore?: BackupTargetPolicyStore;
}

class MutableBackupTargetCatalog extends InMemoryBackupTargetCatalog {
  #current: readonly BackupTarget[];
  public constructor(targets: readonly BackupTarget[]) {
    super(targets);
    this.#current = Object.freeze([...targets]);
  }
  public override list(): readonly BackupTarget[] {
    return this.#current;
  }
  public override findById(id: string): BackupTarget | null {
    return this.#current.find((target) => target.id === id) ?? null;
  }
  public updateSchedule(id: string, schedule: BackupSchedule): BackupTarget {
    const target = this.findById(id);
    if (target === null) throw new Error("registered_backup_target_not_found");
    const next = Object.freeze({ ...target, schedule });
    this.#current = Object.freeze(
      this.#current.map((item) => (item.id === id ? next : item)),
    );
    return next;
  }
  public updateRetention(
    id: string,
    retention: BackupRetentionPolicy,
  ): BackupTarget {
    const target = this.findById(id);
    if (target === null) throw new Error("registered_backup_target_not_found");
    const next = Object.freeze({ ...target, retention });
    this.#current = Object.freeze(
      this.#current.map((item) => (item.id === id ? next : item)),
    );
    return next;
  }
}

export function createBackupManagement(
  input: BackupManagementCompositionInput,
): BackupManagementCapabilities {
  const policyStore =
    input.policyStore ??
    new FileBackupTargetPolicyStore(
      input.destinationRoot ?? BACKUP_DESTINATION_ROOT,
    );
  const catalog = new MutableBackupTargetCatalog(
    policyStore.load(input.targets),
  );
  const clock = input.clock ?? { now: () => new Date() };
  const runs = input.runStore ?? new InMemoryBackupRunStore();
  const gate = new FixedBackupOperationGate();
  const mock = input.adapters?.mock ?? new MockBackupAdapter();
  const filesystem =
    input.adapters?.filesystem_tree ??
    new FilesystemTreeBackupAdapter(input.destinationRoot);
  const run = new RunRegisteredBackup({
    catalog,
    runStore: runs,
    gate,
    clock,
    adapters: { mock, filesystem_tree: filesystem },
  });
  const artifacts =
    input.artifacts ?? new FilesystemBackupArtifactStore(input.destinationRoot);
  const retention = new ApplyRegisteredBackupRetention({
    catalog,
    runs,
    artifacts,
    gate,
    clock,
  });
  const claims =
    input.claims ??
    (input.occurrenceClaimFile === undefined
      ? new InMemoryBackupOccurrenceClaimStore()
      : new FileBackupOccurrenceClaimStore(input.occurrenceClaimFile));
  const cursor =
    input.cursor ??
    (input.schedulerCursorFile === undefined
      ? new InMemoryBackupSchedulerCursorStore()
      : new FileBackupSchedulerCursorStore(input.schedulerCursorFile));
  const scheduler = new RunBackupSchedulerTick({
    catalog,
    cursor,
    claims,
    run,
    clock,
  });
  const readiness = {
    read: async () => {
      if (gate.isActive()) return { state: "active" as const };
      try {
        const snapshot = await runs.reconstruct();
        return {
          state:
            snapshot.interrupted.length > 0
              ? ("interrupted" as const)
              : ("ready" as const),
        };
      } catch {
        return { state: "unavailable" as const };
      }
    },
  };
  return Object.freeze({
    listRegisteredBackupTargets: () => catalog.list(),
    getRegisteredBackupTarget: (id: string) => catalog.findById(id),
    getBackupRuns: (query?: BackupRunQuery) => runs.query(query),
    getBackupRun: (id: string) => runs.getByRunId(id),
    runRegisteredBackup: (value: {
      readonly targetId: string;
      readonly trigger: BackupTrigger;
      readonly scheduledFor?: string;
    }) => run.execute(value),
    getBackupSchedule: (id: string) => requireTarget(catalog, id).schedule,
    setBackupSchedule: (id: string, value: unknown) => {
      const previous = requireTarget(catalog, id);
      const updated = catalog.updateSchedule(id, createBackupSchedule(value));
      try {
        policyStore.save(catalog.list());
      } catch (error) {
        catalog.updateSchedule(id, previous.schedule);
        throw error;
      }
      return updated.schedule;
    },
    removeBackupSchedule: (id: string) => {
      const previous = requireTarget(catalog, id);
      const updated = catalog.updateSchedule(id, {
        mode: "manual",
        timezone: null,
        schedule: null,
      });
      try {
        policyStore.save(catalog.list());
      } catch (error) {
        catalog.updateSchedule(id, previous.schedule);
        throw error;
      }
      return updated.schedule;
    },
    getBackupRetention: (id: string) => requireTarget(catalog, id).retention,
    setBackupRetention: (id: string, value: unknown) => {
      const previous = requireTarget(catalog, id);
      const updated = catalog.updateRetention(id, createRetention(value));
      try {
        policyStore.save(catalog.list());
      } catch (error) {
        catalog.updateRetention(id, previous.retention);
        throw error;
      }
      return updated.retention;
    },
    pruneBackupRetention: (id: string) => retention.execute(id),
    runBackupSchedulerTick: () => scheduler.execute(),
    readiness,
  });
}

function requireTarget(
  catalog: MutableBackupTargetCatalog,
  id: string,
): BackupTarget {
  const target = catalog.findById(id);
  if (target === null) throw new Error("registered_backup_target_not_found");
  return target;
}
