import { ServiceScheduleValidationError } from "./service-schedule-validation-error.js";

export const SERVICE_SCHEDULE_WEEKDAYS = Object.freeze([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const);

export type ServiceScheduleWeekday = (typeof SERVICE_SCHEDULE_WEEKDAYS)[number];

const weekdayAllowlist = new Set<unknown>(SERVICE_SCHEDULE_WEEKDAYS);

export function createServiceScheduleWeekday(
  value: string,
): ServiceScheduleWeekday {
  if (!weekdayAllowlist.has(value)) {
    throw new ServiceScheduleValidationError("invalid_schedule_weekday");
  }

  return value as ServiceScheduleWeekday;
}
