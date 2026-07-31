import type { WakeAlarmMutationResult } from "../domain/wake-alarm-mutation-result.js";
import type { WakeAlarmController } from "./ports/wake-alarm-controller.js";
import type { PowerManagementClock } from "./ports/power-management-clock.js";

export class CancelWakeAlarm {
  public constructor(
    private readonly clock: PowerManagementClock,
    private readonly controller: WakeAlarmController,
  ) {
    Object.freeze(this);
  }

  public async execute(): Promise<WakeAlarmMutationResult> {
    const requestedAt = this.clock.now().toISOString();
    return this.controller.cancel(requestedAt);
  }
}
