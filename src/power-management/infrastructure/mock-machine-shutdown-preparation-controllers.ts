/* eslint-disable @typescript-eslint/require-await */
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "../domain/machine-shutdown-occurrence.js";
import type {
  ActiveTaskDrainResult,
  BackupCompletionResult,
  FilesystemSynchronizationResult,
  MachineShutdownActiveTaskDrainController,
  MachineShutdownBackupCompletionController,
  MachineShutdownFilesystemSynchronizationController,
} from "../application/ports/machine-shutdown-preparation-controllers.js";
import type {
  MachineShutdownActiveTaskReadinessReader,
  MachineShutdownBackupReadinessReader,
  MachineShutdownFilesystemReadinessReader,
  MachineReadinessState,
} from "../application/ports/machine-shutdown-readiness-readers.js";

export interface MockPreparationInvocation {
  readonly occurrence: MachineShutdownOccurrence;
  readonly requestedAt: string;
}

export type MockActiveTaskState = "active" | "drained" | "blocked";
export type MockActiveTaskConfiguration =
  | MockActiveTaskState
  | Readonly<{ state: MockActiveTaskState; reject?: boolean }>;

export class MockMachineShutdownActiveTaskDrainController
  implements
    MachineShutdownActiveTaskDrainController,
    MachineShutdownActiveTaskReadinessReader
{
  public calls = 0;
  readonly #invocations: MockPreparationInvocation[] = [];
  #state: MockActiveTaskState;
  readonly #reject: boolean;
  public constructor(configuration: MockActiveTaskConfiguration = "drained") {
    this.#state =
      typeof configuration === "string" ? configuration : configuration.state;
    this.#reject =
      typeof configuration === "string"
        ? false
        : (configuration.reject ?? false);
  }
  public async drain(
    occurrence: MachineShutdownOccurrence,
    requestedAt: string,
  ): Promise<ActiveTaskDrainResult> {
    this.calls += 1;
    this.#invocations.push(invocation(occurrence, requestedAt));
    if (this.#reject) throw new Error("active_task_drain_failed");
    if (this.#state === "blocked")
      return { outcome: "blocked", remainingTaskCount: 1 };
    if (this.#state === "drained") return { outcome: "already_drained" };
    this.#state = "drained";
    return { outcome: "drained" };
  }
  public get invocations(): readonly MockPreparationInvocation[] {
    return Object.freeze([...this.#invocations]);
  }
  public async read(
    _occurrence: MachineShutdownOccurrence,
    _evaluatedAt: string,
  ): Promise<MachineReadinessState> {
    void _occurrence;
    void _evaluatedAt;
    if (this.#reject) throw new Error("active_task_read_failed");
    return this.#state === "drained"
      ? { area: "active_tasks", state: "ready" }
      : {
          area: "active_tasks",
          state: "blocked",
          activeTaskCount: 1,
        };
  }
}

export type MockBackupState = "in_progress" | "complete" | "blocked";
export type MockBackupConfiguration =
  MockBackupState | Readonly<{ state: MockBackupState; reject?: boolean }>;

export class MockMachineShutdownBackupCompletionController
  implements
    MachineShutdownBackupCompletionController,
    MachineShutdownBackupReadinessReader
{
  public calls = 0;
  readonly #invocations: MockPreparationInvocation[] = [];
  #state: MockBackupState;
  readonly #reject: boolean;
  public constructor(configuration: MockBackupConfiguration = "complete") {
    this.#state =
      typeof configuration === "string" ? configuration : configuration.state;
    this.#reject =
      typeof configuration === "string"
        ? false
        : (configuration.reject ?? false);
  }
  public async complete(
    occurrence: MachineShutdownOccurrence,
    requestedAt: string,
  ): Promise<BackupCompletionResult> {
    this.calls += 1;
    this.#invocations.push(invocation(occurrence, requestedAt));
    if (this.#reject) throw new Error("backup_completion_failed");
    if (this.#state === "blocked")
      return { outcome: "blocked", reason: "backup_completion_failed" };
    if (this.#state === "in_progress") {
      this.#state = "complete";
      return { outcome: "completed" };
    }
    return { outcome: "not_running" };
  }
  public get invocations(): readonly MockPreparationInvocation[] {
    return Object.freeze([...this.#invocations]);
  }
  public async read(
    _occurrence: MachineShutdownOccurrence,
    _evaluatedAt: string,
  ): Promise<MachineReadinessState> {
    void _occurrence;
    void _evaluatedAt;
    if (this.#reject) throw new Error("backup_read_failed");
    return this.#state === "complete"
      ? { area: "backups", state: "ready" }
      : this.#state === "in_progress"
        ? {
            area: "backups",
            state: "blocked",
            reason: "backup_in_progress",
          }
        : {
            area: "backups",
            state: "blocked",
            reason: "backup_state_unknown",
          };
  }
}

export type MockFilesystemState = "required" | "synchronized" | "blocked";
export type MockFilesystemConfiguration =
  | MockFilesystemState
  | Readonly<{ state: MockFilesystemState; reject?: boolean }>;

export class MockMachineShutdownFilesystemSynchronizationController
  implements
    MachineShutdownFilesystemSynchronizationController,
    MachineShutdownFilesystemReadinessReader
{
  public calls = 0;
  readonly #invocations: MockPreparationInvocation[] = [];
  #state: MockFilesystemState;
  readonly #reject: boolean;
  public constructor(
    configuration: MockFilesystemConfiguration = "synchronized",
  ) {
    this.#state =
      typeof configuration === "string" ? configuration : configuration.state;
    this.#reject =
      typeof configuration === "string"
        ? false
        : (configuration.reject ?? false);
  }
  public async synchronize(
    occurrence: MachineShutdownOccurrence,
    requestedAt: string,
  ): Promise<FilesystemSynchronizationResult> {
    this.calls += 1;
    this.#invocations.push(invocation(occurrence, requestedAt));
    if (this.#reject) throw new Error("filesystem_synchronization_failed");
    if (this.#state === "blocked")
      return {
        outcome: "blocked",
        reason: "filesystem_synchronization_failed",
      };
    if (this.#state === "required") {
      this.#state = "synchronized";
      return { outcome: "synchronized" };
    }
    return { outcome: "already_synchronized" };
  }
  public get invocations(): readonly MockPreparationInvocation[] {
    return Object.freeze([...this.#invocations]);
  }
  public async read(
    _occurrence: MachineShutdownOccurrence,
    _evaluatedAt: string,
  ): Promise<MachineReadinessState> {
    void _occurrence;
    void _evaluatedAt;
    if (this.#reject) throw new Error("filesystem_read_failed");
    return this.#state === "synchronized"
      ? { area: "filesystem", state: "ready" }
      : this.#state === "required"
        ? {
            area: "filesystem",
            state: "blocked",
            reason: "filesystem_sync_required",
          }
        : {
            area: "filesystem",
            state: "blocked",
            reason: "filesystem_state_unknown",
          };
  }
}

function invocation(
  occurrence: MachineShutdownOccurrence,
  requestedAt: string,
): MockPreparationInvocation {
  return Object.freeze({
    occurrence: createMachineShutdownOccurrence(occurrence),
    requestedAt,
  });
}
