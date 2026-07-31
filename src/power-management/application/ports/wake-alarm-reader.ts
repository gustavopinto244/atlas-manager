import type { WakeAlarmObservation } from "../../domain/wake-alarm-observation.js";

export interface WakeAlarmReader {
  read(observedAt: string): Promise<WakeAlarmObservation>;
}
