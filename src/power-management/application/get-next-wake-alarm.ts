import type { WakeAlarmObservation } from "../domain/wake-alarm-observation.js";
import type { PowerManagementClock } from "./ports/power-management-clock.js";
import type { WakeAlarmReader } from "./ports/wake-alarm-reader.js";
import { isCanonicalTimestamp } from "../domain/canonical-timestamp.js";

export class GetNextWakeAlarm {
  public constructor(
    private readonly clock: PowerManagementClock,
    private readonly reader: WakeAlarmReader,
  ) {
    Object.freeze(this);
  }

  public async execute(): Promise<WakeAlarmObservation> {
    const observedAt = this.clock.now().toISOString();
    return this.executeAt(observedAt);
  }

  public async executeAt(observedAt: string): Promise<WakeAlarmObservation> {
    if (!isCanonicalTimestamp(observedAt))
      throw new Error("Invalid wake-alarm observation timestamp");
    return this.reader.read(observedAt);
  }
}
