import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  MACHINE_SHUTDOWN_PREPARATION_STEPS,
  type MachineShutdownPreparationStep,
} from "./machine-shutdown-preparation-plan.js";
import {
  createMachineShutdownServicePreparationResult,
  type MachineShutdownServicePreparationStep,
} from "./machine-shutdown-service-preparation-result.js";

export type MachineShutdownPreparationStepOutcome =
  "completed" | "skipped" | "blocked" | "failed";

export type MachineShutdownPreparationStepDetail =
  | Readonly<{
      serviceSteps: readonly MachineShutdownServicePreparationStep[];
      failureCode?: string;
    }>
  | Readonly<{
      outcome: "drained" | "already_drained";
    }>
  | Readonly<{
      outcome:
        "completed" | "not_running" | "synchronized" | "already_synchronized";
    }>
  | Readonly<{
      failureCode: string;
      remainingTaskCount?: number;
    }>;

export interface MachineShutdownPreparationStepResult {
  readonly kind: MachineShutdownPreparationStep;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: MachineShutdownPreparationStepOutcome;
  readonly detail?: MachineShutdownPreparationStepDetail;
}

export function createMachineShutdownPreparationStepResult(
  input: unknown,
): MachineShutdownPreparationStepResult {
  if (
    !isRecord(input) ||
    !MACHINE_SHUTDOWN_PREPARATION_STEPS.includes(
      input.kind as MachineShutdownPreparationStep,
    ) ||
    !isCanonicalTimestamp(input.startedAt) ||
    !isCanonicalTimestamp(input.completedAt) ||
    !["completed", "skipped", "blocked", "failed"].includes(
      String(input.outcome),
    )
  )
    throw new Error("Invalid machine shutdown preparation step result");
  if (
    Reflect.ownKeys(input).some(
      (key) =>
        typeof key !== "string" ||
        !["kind", "startedAt", "completedAt", "outcome", "detail"].includes(
          key,
        ),
    )
  )
    throw new Error("Invalid machine shutdown preparation step result");

  const detail = Object.hasOwn(input, "detail")
    ? validateDetail(
        input.kind as MachineShutdownPreparationStep,
        input.outcome as MachineShutdownPreparationStepOutcome,
        input.detail,
      )
    : undefined;
  if (
    [
      "record_preparation_started",
      "record_preparation_completed",
      "reevaluate_readiness",
      "record_final_readiness",
    ].includes(input.kind as string) &&
    detail !== undefined
  )
    throw new Error("Invalid machine shutdown preparation step detail");
  return Object.freeze({
    kind: input.kind as MachineShutdownPreparationStep,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    outcome: input.outcome as MachineShutdownPreparationStepOutcome,
    ...(detail ? { detail } : {}),
  });
}

function validateDetail(
  kind: MachineShutdownPreparationStep,
  outcome: MachineShutdownPreparationStepOutcome,
  input: unknown,
): MachineShutdownPreparationStepDetail {
  if (!isRecord(input))
    throw new Error("Invalid machine shutdown preparation step detail");
  if (kind === "stop_registered_services") {
    if (!Object.hasOwn(input, "serviceSteps"))
      throw new Error("Invalid machine shutdown service detail");
    const result = createMachineShutdownServicePreparationResult({
      requestedAt: "2026-01-01T00:00:00.000Z",
      steps: input.serviceSteps,
      successful: outcome !== "failed",
    });
    if (
      Reflect.ownKeys(input).some(
        (key) =>
          typeof key !== "string" ||
          !["serviceSteps", "failureCode"].includes(key),
      ) ||
      (outcome === "failed" && typeof input.failureCode !== "string") ||
      (outcome !== "failed" && Object.hasOwn(input, "failureCode")) ||
      (outcome === "failed" &&
        !isServiceFailureCode(input.failureCode as string))
    )
      throw new Error("Invalid machine shutdown service detail");
    return Object.freeze({
      serviceSteps: result.steps,
      ...(outcome === "failed"
        ? { failureCode: input.failureCode as string }
        : {}),
    });
  }
  if (
    kind === "drain_active_tasks" &&
    (outcome === "completed" || outcome === "skipped")
  ) {
    if (
      Reflect.ownKeys(input).length !== 1 ||
      (input.outcome !== "drained" && input.outcome !== "already_drained")
    )
      throw new Error("Invalid machine shutdown task detail");
    return Object.freeze({
      outcome: input.outcome,
    });
  }
  if (
    (kind === "complete_backup" || kind === "synchronize_filesystem") &&
    (outcome === "completed" || outcome === "skipped")
  ) {
    const accepted =
      kind === "complete_backup"
        ? ["completed", "not_running"]
        : ["synchronized", "already_synchronized"];
    if (
      Reflect.ownKeys(input).length !== 1 ||
      !accepted.includes(String(input.outcome))
    )
      throw new Error("Invalid machine shutdown state detail");
    return Object.freeze({
      outcome: input.outcome as
        "completed" | "not_running" | "synchronized" | "already_synchronized",
    });
  }
  if (
    (outcome === "blocked" || outcome === "failed") &&
    typeof input.failureCode === "string" &&
    Reflect.ownKeys(input).every(
      (key) =>
        typeof key === "string" &&
        ["failureCode", "remainingTaskCount"].includes(key),
    )
  ) {
    if (
      Object.hasOwn(input, "remainingTaskCount") &&
      (!Number.isInteger(input.remainingTaskCount) ||
        (input.remainingTaskCount as number) < 1 ||
        (input.remainingTaskCount as number) > 10000)
    )
      throw new Error("Invalid machine shutdown task detail");
    if (!isFailureCodeAllowed(kind, outcome, input.failureCode))
      throw new Error("Invalid machine shutdown preparation failure code");
    if (
      kind === "drain_active_tasks" &&
      outcome === "blocked" &&
      !Object.hasOwn(input, "remainingTaskCount")
    )
      throw new Error("Invalid machine shutdown task detail");
    if (
      kind !== "drain_active_tasks" &&
      Object.hasOwn(input, "remainingTaskCount")
    )
      throw new Error("Invalid machine shutdown task detail");
    return Object.freeze({
      failureCode: input.failureCode,
      ...(Object.hasOwn(input, "remainingTaskCount")
        ? { remainingTaskCount: input.remainingTaskCount as number }
        : {}),
    });
  }
  throw new Error("Invalid machine shutdown preparation step detail");
}

function isServiceFailureCode(value: string): boolean {
  return [
    "service_status_failed",
    "service_stop_not_supported",
    "service_stop_failed",
    "service_plan_invalid",
  ].includes(value);
}

function isFailureCodeAllowed(
  kind: MachineShutdownPreparationStep,
  outcome: MachineShutdownPreparationStepOutcome,
  value: string,
): boolean {
  if (kind === "drain_active_tasks")
    return outcome === "blocked"
      ? value === "active_tasks_present"
      : value === "preparation_dependency_failed";
  if (kind === "complete_backup")
    return outcome === "blocked"
      ? value === "backup_completion_failed" ||
          value === "backup_completion_unknown"
      : value === "preparation_dependency_failed";
  if (kind === "synchronize_filesystem")
    return outcome === "blocked"
      ? value === "filesystem_synchronization_failed" ||
          value === "filesystem_synchronization_unknown"
      : value === "preparation_dependency_failed";
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
