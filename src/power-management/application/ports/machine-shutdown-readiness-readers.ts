import type { MachineShutdownOccurrence } from "../../domain/machine-shutdown-occurrence.js";
import type { MachineShutdownReadinessBlocker } from "../../domain/machine-shutdown-readiness-blocker.js";

export type MachineReadinessState =
  | Readonly<{
      area: "active_tasks" | "backups" | "filesystem" | "event_recording";
      state: "ready";
    }>
  | Readonly<{
      area: "active_tasks";
      state: "blocked";
      activeTaskCount: number;
    }>
  | Readonly<{
      area: "backups";
      state: "blocked";
      reason: "backup_in_progress" | "backup_state_unknown";
    }>
  | Readonly<{
      area: "filesystem";
      state: "blocked";
      reason: "filesystem_sync_required" | "filesystem_state_unknown";
    }>
  | Readonly<{
      area: "event_recording";
      state: "blocked";
      reason: "event_recording_unavailable";
    }>;
export interface MachineShutdownConfirmationReader {
  read(
    occurrence: MachineShutdownOccurrence,
    evaluatedAt: string,
  ): Promise<"confirmed" | "not_confirmed">;
}
export interface MachineShutdownServiceReadinessReader {
  read(
    occurrence: MachineShutdownOccurrence,
    evaluatedAt: string,
  ): Promise<
    | Readonly<{ state: "ready"; blockers: readonly [] }>
    | Readonly<{
        state: "blocked";
        blockers: readonly MachineShutdownReadinessBlocker[];
      }>
  >;
}
export interface MachineShutdownActiveTaskReadinessReader {
  read(
    occurrence: MachineShutdownOccurrence,
    evaluatedAt: string,
  ): Promise<MachineReadinessState>;
}
export interface MachineShutdownBackupReadinessReader {
  read(
    occurrence: MachineShutdownOccurrence,
    evaluatedAt: string,
  ): Promise<MachineReadinessState>;
}
export interface MachineShutdownFilesystemReadinessReader {
  read(
    occurrence: MachineShutdownOccurrence,
    evaluatedAt: string,
  ): Promise<MachineReadinessState>;
}
export interface MachineShutdownEventRecordingReadinessReader {
  read(
    occurrence: MachineShutdownOccurrence,
    evaluatedAt: string,
  ): Promise<MachineReadinessState>;
}
