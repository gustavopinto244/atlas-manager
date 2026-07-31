import type { MachineShutdownOccurrence } from "../../domain/machine-shutdown-occurrence.js";
import type { MachineShutdownOccurrenceClaimResult } from "../../domain/machine-shutdown-occurrence-claim-result.js";
import type { MachinePowerSchedulerCursor } from "../../domain/machine-power-scheduler-cursor.js";
import type { MachineShutdownOccurrenceClaimPruningResult } from "../../domain/machine-shutdown-occurrence-claim-pruning-result.js";

export interface MachineShutdownOccurrenceClaimStore {
  claim(
    occurrence: MachineShutdownOccurrence,
  ): Promise<MachineShutdownOccurrenceClaimResult>;
  pruneCompletedThrough(
    cursor: MachinePowerSchedulerCursor,
  ): Promise<MachineShutdownOccurrenceClaimPruningResult>;
}
