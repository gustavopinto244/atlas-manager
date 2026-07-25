import {
  createServiceAvailabilityMode,
  type ServiceAvailabilityMode,
} from "./service-availability-mode.js";
import { ServiceAvailabilityPolicyValidationError } from "./service-availability-policy-validation-error.js";
import {
  createServiceScheduleTimezone,
  type ServiceScheduleTimezone,
} from "./service-schedule-timezone.js";
import {
  createWeeklyAvailabilitySchedule,
  type WeeklyAvailabilitySchedule,
} from "./weekly-availability-schedule.js";
import type { WeeklyAvailabilityWindowInput } from "./weekly-availability-window.js";

export type ServiceAvailabilityPolicyInput =
  | {
      readonly mode: string;
    }
  | {
      readonly mode: string;
      readonly timezone: string;
      readonly windows: readonly WeeklyAvailabilityWindowInput[];
    };

export type NonScheduledServiceAvailabilityMode = Exclude<
  ServiceAvailabilityMode,
  "scheduled"
>;

export interface NonScheduledServiceAvailabilityPolicy {
  readonly mode: NonScheduledServiceAvailabilityMode;
  readonly timezone: null;
  readonly schedule: null;
}

export interface ScheduledServiceAvailabilityPolicy {
  readonly mode: "scheduled";
  readonly timezone: ServiceScheduleTimezone;
  readonly schedule: WeeklyAvailabilitySchedule;
}

export type ServiceAvailabilityPolicy =
  NonScheduledServiceAvailabilityPolicy | ScheduledServiceAvailabilityPolicy;

const NON_SCHEDULED_POLICY_FIELDS = Object.freeze(["mode"] as const);
const SCHEDULED_POLICY_FIELDS = Object.freeze([
  "mode",
  "timezone",
  "windows",
] as const);

export function createServiceAvailabilityPolicy(
  input: unknown,
): ServiceAvailabilityPolicy {
  if (!isPolicyObject(input) || !Object.hasOwn(input, "mode")) {
    throw new ServiceAvailabilityPolicyValidationError();
  }

  const mode = createServiceAvailabilityMode(input.mode as string);

  if (mode !== "scheduled") {
    if (!hasExactFields(input, NON_SCHEDULED_POLICY_FIELDS)) {
      throw new ServiceAvailabilityPolicyValidationError();
    }

    return Object.freeze({
      mode,
      timezone: null,
      schedule: null,
    });
  }

  if (
    !hasExactFields(input, SCHEDULED_POLICY_FIELDS) ||
    input.timezone === undefined ||
    input.windows === undefined
  ) {
    throw new ServiceAvailabilityPolicyValidationError();
  }

  const timezone = createServiceScheduleTimezone(input.timezone as string);
  const schedule = createWeeklyAvailabilitySchedule(
    input.windows as readonly WeeklyAvailabilityWindowInput[],
  );

  return Object.freeze({ mode, timezone, schedule });
}

function isPolicyObject(input: unknown): input is Record<PropertyKey, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasExactFields(
  input: Record<PropertyKey, unknown>,
  expectedFields: readonly string[],
): boolean {
  const ownKeys = Reflect.ownKeys(input);

  return (
    ownKeys.length === expectedFields.length &&
    expectedFields.every((field) => Object.hasOwn(input, field)) &&
    ownKeys.every(
      (key) => typeof key === "string" && expectedFields.includes(key),
    )
  );
}
