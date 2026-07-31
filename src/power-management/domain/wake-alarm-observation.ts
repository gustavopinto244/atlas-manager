import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  createWakeAlarmState,
  WakeAlarmStateValidationError,
  type WakeAlarmState,
} from "./wake-alarm-state.js";

export interface WakeAlarmObservation {
  readonly observedAt: string;
  readonly wakeAlarm: WakeAlarmState;
}

export type WakeAlarmObservationValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_observed_at"
  | "invalid_wake_alarm";

export class WakeAlarmObservationValidationError extends Error {
  public override readonly name = "WakeAlarmObservationValidationError";

  public constructor(
    public readonly code: WakeAlarmObservationValidationErrorCode,
  ) {
    super(`Invalid wake-alarm observation: ${code}`);
    Object.freeze(this);
  }
}

export function createWakeAlarmObservation(
  input: unknown,
): WakeAlarmObservation {
  if (!isRecord(input)) {
    throw new WakeAlarmObservationValidationError("invalid_record");
  }

  const fields = Object.keys(input);
  if (fields.some((field) => field !== "observedAt" && field !== "wakeAlarm")) {
    throw new WakeAlarmObservationValidationError("invalid_field");
  }

  if (!isCanonicalTimestamp(input["observedAt"])) {
    throw new WakeAlarmObservationValidationError("invalid_observed_at");
  }

  let wakeAlarm: WakeAlarmState;
  try {
    wakeAlarm = createWakeAlarmState(input["wakeAlarm"]);
  } catch (error) {
    if (error instanceof WakeAlarmStateValidationError) {
      throw new WakeAlarmObservationValidationError("invalid_wake_alarm");
    }
    throw error;
  }

  return Object.freeze({
    observedAt: input["observedAt"],
    wakeAlarm,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
