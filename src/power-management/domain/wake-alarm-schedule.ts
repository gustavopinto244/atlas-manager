import { isCanonicalTimestamp } from "./canonical-timestamp.js";

export interface WakeAlarmSchedule {
  readonly scheduledFor: string;
}

export type WakeAlarmScheduleValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "missing_scheduled_for"
  | "invalid_scheduled_for"
  | "invalid_requested_at"
  | "scheduled_for_not_future";

export class WakeAlarmScheduleValidationError extends Error {
  public override readonly name = "WakeAlarmScheduleValidationError";

  public constructor(
    public readonly code: WakeAlarmScheduleValidationErrorCode,
  ) {
    super(`Invalid wake-alarm schedule: ${code}`);
    Object.freeze(this);
  }
}

export function createWakeAlarmSchedule(input: unknown): WakeAlarmSchedule {
  if (!isRecord(input)) {
    throw new WakeAlarmScheduleValidationError("invalid_record");
  }

  const fields = Object.keys(input);
  if (fields.some((field) => field !== "scheduledFor")) {
    throw new WakeAlarmScheduleValidationError("invalid_field");
  }
  if (!Object.hasOwn(input, "scheduledFor")) {
    throw new WakeAlarmScheduleValidationError("missing_scheduled_for");
  }

  const scheduledFor = input["scheduledFor"];
  if (!isCanonicalTimestamp(scheduledFor)) {
    throw new WakeAlarmScheduleValidationError("invalid_scheduled_for");
  }

  return Object.freeze({ scheduledFor });
}

export function assertWakeAlarmScheduleIsFuture(
  requestedAt: string,
  scheduledFor: string,
): void {
  if (!isCanonicalTimestamp(requestedAt)) {
    throw new WakeAlarmScheduleValidationError("invalid_requested_at");
  }
  if (!isComparableTimestamp(scheduledFor)) {
    throw new WakeAlarmScheduleValidationError("invalid_scheduled_for");
  }

  if (Date.parse(scheduledFor) <= Date.parse(requestedAt)) {
    throw new WakeAlarmScheduleValidationError("scheduled_for_not_future");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isComparableTimestamp(value: unknown): value is string {
  if (isCanonicalTimestamp(value)) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) {
    return false;
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    millisecondText,
    timezone,
  ] = match;
  if (timezone === undefined) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(millisecondText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    millisecond > 999
  ) {
    return false;
  }

  const localTime = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const normalizedDay = new Date(localTime).getUTCDate();
  if (
    normalizedDay !== day ||
    new Date(localTime).getUTCMonth() !== month - 1
  ) {
    return false;
  }

  const offsetMinutes =
    timezone === "Z"
      ? 0
      : Number(timezone.slice(1, 3)) * 60 + Number(timezone.slice(4, 6));
  if (timezone !== "Z" && offsetMinutes > 23 * 60 + 59) {
    return false;
  }
  const signedOffsetMinutes =
    timezone === "Z" || timezone[0] === "+" ? offsetMinutes : -offsetMinutes;
  return (
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) === localTime - signedOffsetMinutes * 60_000
  );
}
