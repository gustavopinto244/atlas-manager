import type { MachineShutdownOccurrence } from "../../domain/machine-shutdown-occurrence.js";
import type { MachineShutdownServicePreparationResult } from "../../domain/machine-shutdown-service-preparation-result.js";
export interface MachineShutdownServicePreparationController {
  prepare(input: {
    readonly occurrence: MachineShutdownOccurrence;
    readonly requestedAt: string;
    readonly serviceIds: readonly string[];
  }): Promise<MachineShutdownServicePreparationResult>;
}
export type ActiveTaskDrainResult =
  | Readonly<{ outcome: "drained" | "already_drained" }>
  | Readonly<{ outcome: "blocked"; remainingTaskCount: number }>;
export interface MachineShutdownActiveTaskDrainController {
  drain(
    occurrence: MachineShutdownOccurrence,
    requestedAt: string,
  ): Promise<ActiveTaskDrainResult>;
}
export type BackupCompletionResult =
  | Readonly<{ outcome: "completed" | "not_running" }>
  | Readonly<{
      outcome: "blocked";
      reason: "backup_completion_failed" | "backup_completion_unknown";
    }>;
export interface MachineShutdownBackupCompletionController {
  complete(
    occurrence: MachineShutdownOccurrence,
    requestedAt: string,
  ): Promise<BackupCompletionResult>;
}
export type FilesystemSynchronizationResult =
  | Readonly<{ outcome: "synchronized" | "already_synchronized" }>
  | Readonly<{
      outcome: "blocked";
      reason:
        | "filesystem_synchronization_failed"
        | "filesystem_synchronization_unknown";
    }>;
export interface MachineShutdownFilesystemSynchronizationController {
  synchronize(
    occurrence: MachineShutdownOccurrence,
    requestedAt: string,
  ): Promise<FilesystemSynchronizationResult>;
}
import type { MachineShutdownPreparationEvent } from "../../domain/machine-shutdown-preparation-event.js";
export interface MachineShutdownPreparationEventRecorder {
  record(event: MachineShutdownPreparationEvent): Promise<void>;
}
