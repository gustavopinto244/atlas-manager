import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  createWakeAlarmState,
  WakeAlarmStateValidationError,
  type WakeAlarmState,
} from "./wake-alarm-state.js";

export interface RtcInformation {
  readonly observedAt: string;
  readonly rtcTime: string;
  readonly wakeAlarm: WakeAlarmState;
}

export type RtcInformationValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_observed_at"
  | "invalid_rtc_time"
  | "invalid_wake_alarm";

export class RtcInformationValidationError extends Error {
  public override readonly name = "RtcInformationValidationError";

  public constructor(public readonly code: RtcInformationValidationErrorCode) {
    super(`Invalid RTC information: ${code}`);
    Object.freeze(this);
  }
}

export function createRtcInformation(input: unknown): RtcInformation {
  if (!isRecord(input)) {
    throw new RtcInformationValidationError("invalid_record");
  }

  const fields = Object.keys(input);
  if (
    fields.some(
      (field) =>
        field !== "observedAt" && field !== "rtcTime" && field !== "wakeAlarm",
    )
  ) {
    throw new RtcInformationValidationError("invalid_field");
  }

  if (!isCanonicalTimestamp(input["observedAt"])) {
    throw new RtcInformationValidationError("invalid_observed_at");
  }
  if (!isCanonicalTimestamp(input["rtcTime"])) {
    throw new RtcInformationValidationError("invalid_rtc_time");
  }

  let wakeAlarm: WakeAlarmState;
  try {
    wakeAlarm = createWakeAlarmState(input["wakeAlarm"]);
  } catch (error) {
    if (error instanceof WakeAlarmStateValidationError) {
      throw new RtcInformationValidationError("invalid_wake_alarm");
    }
    throw error;
  }

  return Object.freeze({
    observedAt: input["observedAt"],
    rtcTime: input["rtcTime"],
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
