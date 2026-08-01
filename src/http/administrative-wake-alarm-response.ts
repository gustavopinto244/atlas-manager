import {
  createWakeAlarmMutationResult,
  type WakeAlarmMutationResult,
} from "../power-management/domain/wake-alarm-mutation-result.js";
import { createWakeAlarmObservation } from "../power-management/domain/wake-alarm-observation.js";
import type { WakeAlarmState } from "../power-management/domain/wake-alarm-state.js";

export type WakeAlarmObservationHttpResponse = Readonly<{
  observedAt: string;
  wakeAlarm: Readonly<{
    state: WakeAlarmState["state"];
    scheduledFor?: string;
  }>;
}>;

export type WakeAlarmMutationHttpResponse = Readonly<{
  operation: "schedule" | "cancel";
  requestedAt: string;
  outcome: WakeAlarmMutationResult["outcome"];
  before: Readonly<{ state: WakeAlarmState["state"]; scheduledFor?: string }>;
  after: Readonly<{ state: WakeAlarmState["state"]; scheduledFor?: string }>;
}>;

export function mapWakeAlarmObservationResponse(
  input: unknown,
): WakeAlarmObservationHttpResponse {
  const observation = createWakeAlarmObservation(input);
  return Object.freeze({
    observedAt: observation.observedAt,
    wakeAlarm: mapState(observation.wakeAlarm),
  });
}

export function mapWakeAlarmMutationResponse(
  input: unknown,
): WakeAlarmMutationHttpResponse {
  const result = createWakeAlarmMutationResult(input);
  return Object.freeze({
    operation: result.operation,
    requestedAt: result.requestedAt,
    outcome: result.outcome,
    before: mapState(result.before),
    after: mapState(result.after),
  });
}

function mapState(
  state: WakeAlarmState,
): Readonly<{ state: WakeAlarmState["state"]; scheduledFor?: string }> {
  return state.state === "scheduled"
    ? Object.freeze({ state: "scheduled", scheduledFor: state.scheduledFor })
    : Object.freeze({ state: state.state });
}
