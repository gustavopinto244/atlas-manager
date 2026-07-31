import type { WakeAlarmMutationResult } from "../../domain/wake-alarm-mutation-result.js";

export interface WakeAlarmController {
  schedule(
    requestedAt: string,
    scheduledFor: string,
  ): Promise<WakeAlarmMutationResult>;
  cancel(requestedAt: string): Promise<WakeAlarmMutationResult>;
}
