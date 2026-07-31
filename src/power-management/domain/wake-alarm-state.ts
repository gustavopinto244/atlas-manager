import { isCanonicalTimestamp } from "./canonical-timestamp.js";

export type WakeAlarmState =
  | Readonly<{ state: "unsupported" }>
  | Readonly<{ state: "not_scheduled" }>
  | Readonly<{ state: "scheduled"; scheduledFor: string }>;

export type WakeAlarmStateValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_state"
  | "missing_scheduled_for"
  | "unexpected_scheduled_for"
  | "invalid_scheduled_for";

export class WakeAlarmStateValidationError extends Error {
  public override readonly name = "WakeAlarmStateValidationError";

  public constructor(public readonly code: WakeAlarmStateValidationErrorCode) {
    super(`Invalid wake-alarm state: ${code}`);
    Object.freeze(this);
  }
}

export function createWakeAlarmState(input: unknown): WakeAlarmState {
  if (!isRecord(input)) {
    throw new WakeAlarmStateValidationError("invalid_record");
  }

  const fields = Object.keys(input);
  if (fields.some((field) => field !== "state" && field !== "scheduledFor")) {
    throw new WakeAlarmStateValidationError("invalid_field");
  }

  const state = input["state"];
  if (
    state !== "unsupported" &&
    state !== "not_scheduled" &&
    state !== "scheduled"
  ) {
    throw new WakeAlarmStateValidationError("invalid_state");
  }

  const hasScheduledFor = Object.hasOwn(input, "scheduledFor");
  if (state === "scheduled") {
    if (!hasScheduledFor) {
      throw new WakeAlarmStateValidationError("missing_scheduled_for");
    }
    const scheduledFor = input["scheduledFor"];
    if (!isCanonicalTimestamp(scheduledFor)) {
      throw new WakeAlarmStateValidationError("invalid_scheduled_for");
    }
    return Object.freeze({ state, scheduledFor });
  }

  if (hasScheduledFor) {
    throw new WakeAlarmStateValidationError("unexpected_scheduled_for");
  }

  return Object.freeze({ state });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
