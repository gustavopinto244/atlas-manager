/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
export type RegisteredServiceStopOutcome =
  "stopped" | "already_stopped" | "failed";
export type RegisteredServiceStopFailureCode =
  | "service_status_failed"
  | "service_stop_not_supported"
  | "service_stop_failed"
  | "service_plan_invalid";

export interface RegisteredServiceStopStep {
  readonly serviceId: string;
  readonly outcome: RegisteredServiceStopOutcome;
  readonly failureCode?: RegisteredServiceStopFailureCode;
}

export interface RegisteredServicesStopResult {
  readonly authority: "machine_shutdown";
  readonly requestedAt: string;
  readonly steps: readonly RegisteredServiceStopStep[];
  readonly successful: boolean;
}

export function createRegisteredServicesStopResult(
  input: unknown,
): RegisteredServicesStopResult {
  if (
    !isRecord(input) ||
    !isCanonicalTimestamp(input.requestedAt) ||
    input.authority !== "machine_shutdown" ||
    !Array.isArray(input.steps) ||
    typeof input.successful !== "boolean"
  )
    throw new RegisteredServicesStopResultError("invalid_result");
  if (
    Reflect.ownKeys(input).some(
      (key) =>
        typeof key !== "string" ||
        !["authority", "requestedAt", "steps", "successful"].includes(key),
    )
  )
    throw new RegisteredServicesStopResultError("invalid_result");
  const steps = input.steps.map((value) => {
    if (
      !isRecord(value) ||
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== "string" ||
          !["serviceId", "outcome", "failureCode"].includes(key),
      ) ||
      !isServiceId(value.serviceId) ||
      !["stopped", "already_stopped", "failed"].includes(String(value.outcome))
    )
      throw new RegisteredServicesStopResultError("invalid_step");
    if (
      value.outcome === "failed" &&
      ![
        "service_status_failed",
        "service_stop_not_supported",
        "service_stop_failed",
        "service_plan_invalid",
      ].includes(String(value.failureCode))
    )
      throw new RegisteredServicesStopResultError("invalid_step");
    if (value.outcome !== "failed" && Object.hasOwn(value, "failureCode"))
      throw new RegisteredServicesStopResultError("invalid_step");
    return Object.freeze({
      serviceId: value.serviceId,
      outcome: value.outcome,
      ...(value.outcome === "failed" ? { failureCode: value.failureCode } : {}),
    });
  });
  if (
    steps.length < 1 ||
    steps.length > 64 ||
    new Set(steps.map((step) => step.serviceId)).size !== steps.length
  )
    throw new RegisteredServicesStopResultError("invalid_result");
  const hasFailure = steps.some((step) => step.outcome === "failed");
  if (input.successful === hasFailure)
    throw new RegisteredServicesStopResultError("invalid_result");
  if (hasFailure && steps[steps.length - 1]?.outcome !== "failed")
    throw new RegisteredServicesStopResultError("invalid_result");
  return Object.freeze({
    authority: "machine_shutdown" as const,
    requestedAt: input.requestedAt,
    steps: Object.freeze(steps),
    successful: input.successful,
  });
}

export class RegisteredServicesStopResultError extends Error {
  public override readonly name = "RegisteredServicesStopResultError";
  public constructor(public readonly code: "invalid_result" | "invalid_step") {
    super(`Invalid registered services stop result: ${code}`);
    Object.freeze(this);
  }
}

function isServiceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}
function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
