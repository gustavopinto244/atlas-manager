import { ServiceAvailabilityEvaluationError } from "./service-availability-evaluation-error.js";
import type { ServiceAvailabilityPolicy } from "./service-availability-policy.js";
import type { ServiceScheduleWeekday } from "./service-schedule-weekday.js";

export const SERVICE_AVAILABILITY_EXPECTATIONS = Object.freeze([
  "available",
  "unavailable",
  "manual",
  "disabled",
] as const);

export type ServiceAvailabilityExpectation =
  (typeof SERVICE_AVAILABILITY_EXPECTATIONS)[number];

const weekdayByEnglishName: Readonly<Record<string, ServiceScheduleWeekday>> =
  Object.freeze({
    Monday: "monday",
    Tuesday: "tuesday",
    Wednesday: "wednesday",
    Thursday: "thursday",
    Friday: "friday",
    Saturday: "saturday",
    Sunday: "sunday",
  });

export function evaluateServiceAvailabilityPolicy(
  policy: ServiceAvailabilityPolicy,
  instant: Date,
): ServiceAvailabilityExpectation {
  if (!(instant instanceof Date)) {
    throw new ServiceAvailabilityEvaluationError();
  }

  const timestamp = instant.getTime();

  if (!Number.isFinite(timestamp)) {
    throw new ServiceAvailabilityEvaluationError();
  }

  switch (policy.mode) {
    case "always":
      return "available";
    case "manual":
      return "manual";
    case "disabled":
      return "disabled";
    case "scheduled":
      return evaluateScheduledPolicy(policy, timestamp);
  }
}

function evaluateScheduledPolicy(
  policy: Extract<ServiceAvailabilityPolicy, { readonly mode: "scheduled" }>,
  timestamp: number,
): ServiceAvailabilityExpectation {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: policy.timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const weekdayName = getPart(parts, "weekday");
  const weekday = weekdayByEnglishName[weekdayName];
  const hour = getPart(parts, "hour");
  const minute = getPart(parts, "minute");

  if (weekday === undefined) {
    throw new ServiceAvailabilityEvaluationError();
  }

  const localTime = `${hour}:${minute}`;
  const isInsideWindow = policy.schedule.windows.some(
    (window) =>
      window.weekday === weekday &&
      window.start <= localTime &&
      localTime < window.end,
  );

  return isInsideWindow ? "available" : "unavailable";
}

function getPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;

  if (value === undefined) {
    throw new ServiceAvailabilityEvaluationError();
  }

  return value;
}
