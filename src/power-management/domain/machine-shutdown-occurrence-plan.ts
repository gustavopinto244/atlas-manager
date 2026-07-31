import {
  createMachinePowerPlan,
  type MachinePowerPlan,
  MachinePowerPlanValidationError,
} from "./machine-power-plan.js";
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
  MachineShutdownOccurrenceValidationError,
} from "./machine-shutdown-occurrence.js";

export type MachineShutdownOccurrencePlan =
  | Readonly<{ state: "not_planned" }>
  | Readonly<{ state: "planned"; occurrence: MachineShutdownOccurrence }>;
export type MachineShutdownOccurrencePlanValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_state"
  | "missing_occurrence"
  | "unexpected_occurrence"
  | "invalid_occurrence"
  | "invalid_power_plan";
export class MachineShutdownOccurrencePlanValidationError extends Error {
  public override readonly name =
    "MachineShutdownOccurrencePlanValidationError";
  public constructor(
    public readonly code: MachineShutdownOccurrencePlanValidationErrorCode,
  ) {
    super(`Invalid machine shutdown occurrence plan: ${code}`);
    Object.freeze(this);
  }
}

export function createMachineShutdownOccurrencePlan(
  input: unknown,
): MachineShutdownOccurrencePlan {
  if (!isRecord(input))
    throw new MachineShutdownOccurrencePlanValidationError("invalid_record");
  const keys = Reflect.ownKeys(input);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" || (key !== "state" && key !== "occurrence"),
    )
  )
    throw new MachineShutdownOccurrencePlanValidationError("invalid_field");
  if (input["state"] !== "planned" && input["state"] !== "not_planned")
    throw new MachineShutdownOccurrencePlanValidationError("invalid_state");
  const has = Object.hasOwn(input, "occurrence");
  if (input["state"] === "planned") {
    if (!has)
      throw new MachineShutdownOccurrencePlanValidationError(
        "missing_occurrence",
      );
    try {
      return Object.freeze({
        state: "planned" as const,
        occurrence: createMachineShutdownOccurrence(input["occurrence"]),
      });
    } catch (error) {
      if (error instanceof MachineShutdownOccurrenceValidationError)
        throw new MachineShutdownOccurrencePlanValidationError(
          "invalid_occurrence",
        );
      throw error;
    }
  }
  if (has)
    throw new MachineShutdownOccurrencePlanValidationError(
      "unexpected_occurrence",
    );
  return Object.freeze({ state: "not_planned" as const });
}

export function planMachineShutdownOccurrence(
  input: unknown,
): MachineShutdownOccurrencePlan {
  let plan: MachinePowerPlan;
  try {
    plan = createMachinePowerPlan(input);
  } catch (error) {
    if (error instanceof MachinePowerPlanValidationError)
      throw new MachineShutdownOccurrencePlanValidationError(
        "invalid_power_plan",
      );
    throw error;
  }
  if (
    plan.expectation !== "operating" ||
    plan.nextShutdown.state !== "planned" ||
    plan.nextWake.state !== "planned"
  )
    return createMachineShutdownOccurrencePlan({ state: "not_planned" });
  try {
    return createMachineShutdownOccurrencePlan({
      state: "planned",
      occurrence: {
        operation: "shutdown",
        scheduledFor: plan.nextShutdown.scheduledFor,
        wakeScheduledFor: plan.nextWake.scheduledFor,
      },
    });
  } catch (error) {
    if (error instanceof MachineShutdownOccurrencePlanValidationError)
      throw error;
    throw new MachineShutdownOccurrencePlanValidationError(
      "invalid_occurrence",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
