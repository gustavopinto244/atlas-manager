import type { MachineShutdownOccurrence } from "../../domain/machine-shutdown-occurrence.js";
import type { MachineShutdownOccurrenceClaimResult } from "../../domain/machine-shutdown-occurrence-claim-result.js";

export interface MachineShutdownOccurrenceClaimStore {
  claim(
    occurrence: MachineShutdownOccurrence,
  ): Promise<MachineShutdownOccurrenceClaimResult>;
}
