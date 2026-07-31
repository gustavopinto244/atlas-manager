import type { MachineShutdownResult } from "../domain/machine-shutdown-result.js";
import type { MachineShutdownController } from "./ports/machine-shutdown-controller.js";
import type { PowerManagementClock } from "./ports/power-management-clock.js";

export class RequestMachineShutdown {
  public constructor(
    private readonly clock: PowerManagementClock,
    private readonly controller: MachineShutdownController,
  ) {
    Object.freeze(this);
  }

  public async execute(): Promise<MachineShutdownResult> {
    const requestedAt = this.clock.now().toISOString();
    return this.controller.requestShutdown(requestedAt);
  }
}
