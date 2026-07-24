import {
  createServiceScheduleLocalTime,
  type ServiceScheduleLocalTime,
} from "./service-schedule-local-time.js";
import { ServiceScheduleValidationError } from "./service-schedule-validation-error.js";
import {
  createServiceScheduleWeekday,
  type ServiceScheduleWeekday,
} from "./service-schedule-weekday.js";

export interface WeeklyAvailabilityWindowInput {
  readonly weekday: string;
  readonly start: string;
  readonly end: string;
}

export interface WeeklyAvailabilityWindow {
  readonly weekday: ServiceScheduleWeekday;
  readonly start: ServiceScheduleLocalTime;
  readonly end: ServiceScheduleLocalTime;
}

const WINDOW_FIELDS = Object.freeze(["weekday", "start", "end"] as const);

export function createWeeklyAvailabilityWindow(
  input: WeeklyAvailabilityWindowInput,
): WeeklyAvailabilityWindow {
  if (!hasExactWindowShape(input)) {
    throw new ServiceScheduleValidationError(
      "invalid_weekly_availability_window",
    );
  }

  const weekday = createServiceScheduleWeekday(input.weekday);
  const start = createServiceScheduleLocalTime(input.start);
  const end = createServiceScheduleLocalTime(input.end);

  if (start >= end) {
    throw new ServiceScheduleValidationError(
      "invalid_weekly_availability_window",
    );
  }

  return Object.freeze({ weekday, start, end });
}

function hasExactWindowShape(input: WeeklyAvailabilityWindowInput): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const ownKeys = Reflect.ownKeys(input);

  if (
    ownKeys.length !== WINDOW_FIELDS.length ||
    !WINDOW_FIELDS.every((field) => Object.hasOwn(input, field))
  ) {
    return false;
  }

  return ownKeys.every(
    (key) =>
      typeof key === "string" &&
      (WINDOW_FIELDS as readonly string[]).includes(key),
  );
}
