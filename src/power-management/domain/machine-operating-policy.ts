import {
  createMachineWeeklyOperatingSchedule,
  type MachineWeeklyOperatingSchedule,
} from "./machine-weekly-operating-schedule.js";

export const MACHINE_OPERATING_MODES = Object.freeze([
  "always_on",
  "scheduled",
  "manual",
] as const);

export const MACHINE_OPERATING_TIMEZONES = Object.freeze([
  "America/Sao_Paulo",
] as const);

export type MachineOperatingMode = (typeof MACHINE_OPERATING_MODES)[number];
export type MachineOperatingTimezone =
  (typeof MACHINE_OPERATING_TIMEZONES)[number];

export interface AlwaysOnMachineOperatingPolicy {
  readonly mode: "always_on";
}

export interface ManualMachineOperatingPolicy {
  readonly mode: "manual";
}

export interface ScheduledMachineOperatingPolicy {
  readonly mode: "scheduled";
  readonly timezone: MachineOperatingTimezone;
  readonly weeklySchedule: MachineWeeklyOperatingSchedule;
}

export type MachineOperatingPolicy =
  | AlwaysOnMachineOperatingPolicy
  | ManualMachineOperatingPolicy
  | ScheduledMachineOperatingPolicy;

export type MachineOperatingPolicyValidationErrorCode =
  | "invalid_record"
  | "missing_mode"
  | "invalid_mode"
  | "invalid_field"
  | "missing_timezone"
  | "invalid_timezone"
  | "missing_weekly_schedule";

export class MachineOperatingPolicyValidationError extends Error {
  public override readonly name = "MachineOperatingPolicyValidationError";

  public constructor(
    public readonly code: MachineOperatingPolicyValidationErrorCode,
  ) {
    super(`Invalid machine operating policy: ${code}`);
    Object.freeze(this);
  }
}

const NON_SCHEDULED_FIELDS = Object.freeze(["mode"] as const);
const SCHEDULED_FIELDS = Object.freeze([
  "mode",
  "timezone",
  "weeklySchedule",
] as const);
const timezoneAllowlist = new Set<unknown>(MACHINE_OPERATING_TIMEZONES);

export function createMachineOperatingPolicy(
  input: unknown,
): MachineOperatingPolicy {
  if (!isRecord(input)) {
    throw new MachineOperatingPolicyValidationError("invalid_record");
  }
  if (!Object.hasOwn(input, "mode")) {
    throw new MachineOperatingPolicyValidationError("missing_mode");
  }

  const mode = input["mode"];
  if (!isMachineOperatingMode(mode)) {
    throw new MachineOperatingPolicyValidationError("invalid_mode");
  }

  if (mode !== "scheduled") {
    if (!hasExactFields(input, NON_SCHEDULED_FIELDS)) {
      throw new MachineOperatingPolicyValidationError("invalid_field");
    }
    return Object.freeze({ mode });
  }

  if (!Object.hasOwn(input, "timezone")) {
    throw new MachineOperatingPolicyValidationError("missing_timezone");
  }
  if (typeof input["timezone"] !== "string") {
    throw new MachineOperatingPolicyValidationError("invalid_timezone");
  }
  if (!timezoneAllowlist.has(input["timezone"])) {
    throw new MachineOperatingPolicyValidationError("invalid_timezone");
  }
  if (!Object.hasOwn(input, "weeklySchedule")) {
    throw new MachineOperatingPolicyValidationError("missing_weekly_schedule");
  }
  if (!hasExactFields(input, SCHEDULED_FIELDS)) {
    throw new MachineOperatingPolicyValidationError("invalid_field");
  }

  const weeklySchedule = createMachineWeeklyOperatingSchedule(
    input["weeklySchedule"],
  );
  return Object.freeze({
    mode,
    timezone: input["timezone"] as MachineOperatingTimezone,
    weeklySchedule,
  });
}

function isMachineOperatingMode(value: unknown): value is MachineOperatingMode {
  return (
    typeof value === "string" &&
    (MACHINE_OPERATING_MODES as readonly string[]).includes(value)
  );
}

function hasExactFields(
  input: Record<PropertyKey, unknown>,
  expectedFields: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(input);
  return (
    keys.length === expectedFields.length &&
    expectedFields.every((field) => Object.hasOwn(input, field)) &&
    keys.every((key) => typeof key === "string" && expectedFields.includes(key))
  );
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
