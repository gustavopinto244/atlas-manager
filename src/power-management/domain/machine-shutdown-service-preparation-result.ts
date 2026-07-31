import { isCanonicalTimestamp } from "./canonical-timestamp.js";

export type MachineShutdownServicePreparationOutcome =
  "stopped" | "already_stopped" | "failed";

export type MachineShutdownServicePreparationFailureCode =
  | "service_status_failed"
  | "service_stop_not_supported"
  | "service_stop_failed"
  | "service_plan_invalid";

export interface MachineShutdownServicePreparationStep {
  readonly serviceId: string;
  readonly outcome: MachineShutdownServicePreparationOutcome;
  readonly failureCode?: MachineShutdownServicePreparationFailureCode;
}

export interface MachineShutdownServicePreparationResult {
  readonly requestedAt: string;
  readonly steps: readonly MachineShutdownServicePreparationStep[];
  readonly successful: boolean;
}

export function createMachineShutdownServicePreparationResult(
  input: unknown,
): MachineShutdownServicePreparationResult {
  if (
    !isRecord(input) ||
    !isCanonicalTimestamp(input.requestedAt) ||
    !Array.isArray(input.steps) ||
    typeof input.successful !== "boolean"
  )
    throw new Error("Invalid machine shutdown service preparation result");
  if (
    Reflect.ownKeys(input).some(
      (key) =>
        typeof key !== "string" ||
        !["requestedAt", "steps", "successful"].includes(key),
    )
  )
    throw new Error("Invalid machine shutdown service preparation result");

  const steps = input.steps.map((value) => {
    if (
      !isRecord(value) ||
      !isServiceId(value.serviceId) ||
      !["stopped", "already_stopped", "failed"].includes(String(value.outcome))
    )
      throw new Error("Invalid machine shutdown service preparation step");
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== "string" ||
          !["serviceId", "outcome", "failureCode"].includes(key),
      )
    )
      throw new Error("Invalid machine shutdown service preparation step");
    if (
      value.outcome === "failed" &&
      ![
        "service_status_failed",
        "service_stop_not_supported",
        "service_stop_failed",
        "service_plan_invalid",
      ].includes(String(value.failureCode))
    )
      throw new Error("Invalid machine shutdown service preparation step");
    if (value.outcome !== "failed" && Object.hasOwn(value, "failureCode"))
      throw new Error("Invalid machine shutdown service preparation step");
    return Object.freeze({
      serviceId: value.serviceId,
      outcome: value.outcome as MachineShutdownServicePreparationOutcome,
      ...(value.outcome === "failed"
        ? {
            failureCode:
              value.failureCode as MachineShutdownServicePreparationFailureCode,
          }
        : {}),
    });
  });
  if (
    steps.length < 1 ||
    steps.length > 64 ||
    new Set(steps.map((step) => step.serviceId)).size !== steps.length
  )
    throw new Error("Invalid machine shutdown service preparation steps");
  const hasFailure = steps.some((step) => step.outcome === "failed");
  if (input.successful === hasFailure)
    throw new Error("Invalid machine shutdown service preparation success");
  if (hasFailure && steps[steps.length - 1]?.outcome !== "failed")
    throw new Error(
      "Invalid machine shutdown service preparation failure order",
    );
  return Object.freeze({
    requestedAt: input.requestedAt,
    steps: Object.freeze(steps),
    successful: input.successful,
  });
}

function isServiceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
