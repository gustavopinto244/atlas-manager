import { isCanonicalTimestamp } from "./canonical-timestamp.js";

export type MachinePowerTransitionPlan =
  | Readonly<{ state: "not_planned" }>
  | Readonly<{ state: "planned"; scheduledFor: string }>;

export type MachinePowerTransitionPlanValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_state"
  | "missing_scheduled_for"
  | "unexpected_scheduled_for"
  | "invalid_scheduled_for";

export class MachinePowerTransitionPlanValidationError extends Error {
  public override readonly name = "MachinePowerTransitionPlanValidationError";

  public constructor(
    public readonly code: MachinePowerTransitionPlanValidationErrorCode,
  ) {
    super(`Invalid machine power transition plan: ${code}`);
    Object.freeze(this);
  }
}

const PLAN_FIELDS = Object.freeze(["state", "scheduledFor"] as const);

export function createMachinePowerTransitionPlan(
  input: unknown,
): MachinePowerTransitionPlan {
  if (!isRecord(input)) {
    throw new MachinePowerTransitionPlanValidationError("invalid_record");
  }
  if (
    Reflect.ownKeys(input).some(
      (key) =>
        typeof key !== "string" ||
        !(PLAN_FIELDS as readonly string[]).includes(key),
    )
  ) {
    throw new MachinePowerTransitionPlanValidationError("invalid_field");
  }

  const state = input["state"];
  if (state !== "planned" && state !== "not_planned") {
    throw new MachinePowerTransitionPlanValidationError("invalid_state");
  }

  const hasScheduledFor = Object.hasOwn(input, "scheduledFor");
  if (state === "planned") {
    if (!hasScheduledFor) {
      throw new MachinePowerTransitionPlanValidationError(
        "missing_scheduled_for",
      );
    }
    const scheduledFor = input["scheduledFor"];
    if (!isCanonicalTimestamp(scheduledFor)) {
      throw new MachinePowerTransitionPlanValidationError(
        "invalid_scheduled_for",
      );
    }
    return Object.freeze({ state, scheduledFor });
  }

  if (hasScheduledFor) {
    throw new MachinePowerTransitionPlanValidationError(
      "unexpected_scheduled_for",
    );
  }
  return Object.freeze({ state });
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
