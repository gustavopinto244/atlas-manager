import {
  assertWakeAlarmScheduleIsFuture,
  createWakeAlarmSchedule,
} from "../domain/wake-alarm-schedule.js";
import type { WakeAlarmMutationResult } from "../domain/wake-alarm-mutation-result.js";
import type { WakeAlarmController } from "./ports/wake-alarm-controller.js";
import type { PowerManagementClock } from "./ports/power-management-clock.js";

export class ScheduleWakeAlarm {
  public constructor(
    private readonly clock: PowerManagementClock,
    private readonly controller: WakeAlarmController,
  ) {
    Object.freeze(this);
  }

  public async execute(input: unknown): Promise<WakeAlarmMutationResult> {
    const schedule = createWakeAlarmSchedule(input);
    const requestedAt = this.clock.now().toISOString();
    assertWakeAlarmScheduleIsFuture(requestedAt, schedule.scheduledFor);
    return this.controller.schedule(requestedAt, schedule.scheduledFor);
  }
}
