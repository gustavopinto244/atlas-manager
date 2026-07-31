import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  createMachinePowerTransitionPlan,
  type MachinePowerTransitionPlan,
  MachinePowerTransitionPlanValidationError,
} from "./machine-power-transition-plan.js";

export const MACHINE_POWER_EXPECTATIONS = Object.freeze([
  "operating",
  "offline",
  "manual",
] as const);

export type MachinePowerExpectation =
  (typeof MACHINE_POWER_EXPECTATIONS)[number];

export interface MachinePowerPlan {
  readonly evaluatedAt: string;
  readonly expectation: MachinePowerExpectation;
  readonly nextShutdown: MachinePowerTransitionPlan;
  readonly nextWake: MachinePowerTransitionPlan;
}

export type MachinePowerPlanValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_evaluated_at"
  | "invalid_expectation"
  | "invalid_next_shutdown"
  | "invalid_next_wake"
  | "invalid_transition_combination";

export class MachinePowerPlanValidationError extends Error {
  public override readonly name = "MachinePowerPlanValidationError";

  public constructor(
    public readonly code: MachinePowerPlanValidationErrorCode,
  ) {
    super(`Invalid machine power plan: ${code}`);
    Object.freeze(this);
  }
}

const PLAN_FIELDS = Object.freeze([
  "evaluatedAt",
  "expectation",
  "nextShutdown",
  "nextWake",
] as const);

export function createMachinePowerPlan(input: unknown): MachinePowerPlan {
  if (!isRecord(input)) {
    throw new MachinePowerPlanValidationError("invalid_record");
  }
  if (!hasExactFields(input, PLAN_FIELDS)) {
    throw new MachinePowerPlanValidationError("invalid_field");
  }
  if (!isCanonicalTimestamp(input["evaluatedAt"])) {
    throw new MachinePowerPlanValidationError("invalid_evaluated_at");
  }
  if (!isMachinePowerExpectation(input["expectation"])) {
    throw new MachinePowerPlanValidationError("invalid_expectation");
  }

  const nextShutdown = createTransition(
    input["nextShutdown"],
    "invalid_next_shutdown",
  );
  const nextWake = createTransition(input["nextWake"], "invalid_next_wake");
  validateTransitionCombination(
    input["evaluatedAt"],
    input["expectation"],
    nextShutdown,
    nextWake,
  );

  return Object.freeze({
    evaluatedAt: input["evaluatedAt"],
    expectation: input["expectation"],
    nextShutdown,
    nextWake,
  });
}

function createTransition(
  input: unknown,
  errorCode: "invalid_next_shutdown" | "invalid_next_wake",
): MachinePowerTransitionPlan {
  try {
    return createMachinePowerTransitionPlan(input);
  } catch (error) {
    if (error instanceof MachinePowerTransitionPlanValidationError) {
      throw new MachinePowerPlanValidationError(errorCode);
    }
    throw error;
  }
}

function validateTransitionCombination(
  evaluatedAt: string,
  expectation: MachinePowerExpectation,
  nextShutdown: MachinePowerTransitionPlan,
  nextWake: MachinePowerTransitionPlan,
): void {
  if (expectation === "manual") {
    if (
      nextShutdown.state !== "not_planned" ||
      nextWake.state !== "not_planned"
    ) {
      throw new MachinePowerPlanValidationError(
        "invalid_transition_combination",
      );
    }
    return;
  }

  if (nextShutdown.state !== "planned" || nextWake.state !== "planned") {
    if (
      expectation === "operating" &&
      nextShutdown.state === "not_planned" &&
      nextWake.state === "not_planned"
    ) {
      return;
    }
    throw new MachinePowerPlanValidationError("invalid_transition_combination");
  }

  const evaluatedTimestamp = Date.parse(evaluatedAt);
  const shutdownTimestamp = Date.parse(nextShutdown.scheduledFor);
  const wakeTimestamp = Date.parse(nextWake.scheduledFor);

  if (expectation === "operating") {
    if (!(
      evaluatedTimestamp < shutdownTimestamp &&
      shutdownTimestamp < wakeTimestamp
    )) {
      throw new MachinePowerPlanValidationError(
        "invalid_transition_combination",
      );
    }
    return;
  }

  if (!(
    evaluatedTimestamp < wakeTimestamp && wakeTimestamp < shutdownTimestamp
  )) {
    throw new MachinePowerPlanValidationError("invalid_transition_combination");
  }
}

function isMachinePowerExpectation(
  value: unknown,
): value is MachinePowerExpectation {
  return (
    typeof value === "string" &&
    (MACHINE_POWER_EXPECTATIONS as readonly string[]).includes(value)
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
