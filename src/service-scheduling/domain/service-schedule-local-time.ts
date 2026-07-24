import { ServiceScheduleValidationError } from "./service-schedule-validation-error.js";

declare const serviceScheduleLocalTimeBrand: unique symbol;

export type ServiceScheduleLocalTime = string & {
  readonly [serviceScheduleLocalTimeBrand]: true;
};

const LOCAL_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

export function createServiceScheduleLocalTime(
  value: string,
): ServiceScheduleLocalTime {
  if (typeof value !== "string" || !LOCAL_TIME_PATTERN.test(value)) {
    throw new ServiceScheduleValidationError("invalid_schedule_local_time");
  }

  return value as ServiceScheduleLocalTime;
}
