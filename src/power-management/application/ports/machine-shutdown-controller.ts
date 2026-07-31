import type { MachineShutdownResult } from "../../domain/machine-shutdown-result.js";

export interface MachineShutdownController {
  requestShutdown(requestedAt: string): Promise<MachineShutdownResult>;
}
