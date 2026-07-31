/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "./machine-shutdown-occurrence.js";
import {
  createMachineShutdownReadinessDecision,
  type MachineShutdownReadinessDecision,
} from "./machine-shutdown-readiness-decision.js";
import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  MACHINE_SHUTDOWN_BLOCKER_CODES,
  type MachineShutdownReadinessBlocker,
} from "./machine-shutdown-readiness-blocker.js";

export const MACHINE_SHUTDOWN_PREPARATION_STEPS = Object.freeze([
  "record_preparation_started",
  "stop_registered_services",
  "drain_active_tasks",
  "complete_backup",
  "synchronize_filesystem",
  "record_preparation_completed",
  "reevaluate_readiness",
  "record_final_readiness",
] as const);
export type MachineShutdownPreparationStep =
  (typeof MACHINE_SHUTDOWN_PREPARATION_STEPS)[number];
export interface MachineShutdownPreparationPlan {
  readonly occurrence: MachineShutdownOccurrence;
  readonly plannedAt: string;
  readonly initialDecision: MachineShutdownReadinessDecision;
  readonly steps: readonly MachineShutdownPreparationStep[];
}
export function createMachineShutdownPreparationPlan(
  input: unknown,
): MachineShutdownPreparationPlan {
  if (
    !isRecord(input) ||
    !isCanonicalTimestamp(input.plannedAt) ||
    !Array.isArray(input.steps)
  )
    throw new MachineShutdownPreparationPlanError("invalid_plan");
  if (
    Reflect.ownKeys(input).some(
      (key) =>
        typeof key !== "string" ||
        !["occurrence", "plannedAt", "initialDecision", "steps"].includes(key),
    )
  )
    throw new MachineShutdownPreparationPlanError("invalid_plan");
  let occurrence: MachineShutdownOccurrence;
  let decision: MachineShutdownReadinessDecision;
  try {
    occurrence = createMachineShutdownOccurrence(input.occurrence);
    decision = createMachineShutdownReadinessDecision(input.initialDecision);
  } catch {
    throw new MachineShutdownPreparationPlanError("invalid_plan");
  }
  const steps = input.steps.map((step) => {
    if (
      typeof step !== "string" ||
      !MACHINE_SHUTDOWN_PREPARATION_STEPS.includes(
        step as MachineShutdownPreparationStep,
      )
    )
      throw new MachineShutdownPreparationPlanError("invalid_step");
    return step as MachineShutdownPreparationStep;
  });
  const expected = expectedSteps(decision);
  if (
    decision.occurrence.scheduledFor !== occurrence.scheduledFor ||
    decision.occurrence.wakeScheduledFor !== occurrence.wakeScheduledFor ||
    decision.evaluatedAt !== input.plannedAt ||
    expected === null ||
    new Set(steps).size !== steps.length ||
    !steps.every((step, index) => step === expected[index]) ||
    steps.length !== expected.length
  )
    throw new MachineShutdownPreparationPlanError("invalid_step");
  return Object.freeze({
    occurrence,
    plannedAt: input.plannedAt,
    initialDecision: decision,
    steps: Object.freeze(steps),
  });
}

function expectedSteps(
  decision: MachineShutdownReadinessDecision,
): readonly MachineShutdownPreparationStep[] | null {
  if (decision.outcome === "approved") return [];
  if (
    decision.blockers.some(
      (blocker) =>
        !MACHINE_SHUTDOWN_BLOCKER_CODES.includes(blocker.code) ||
        !isPreparableBlocker(blocker),
    )
  )
    return null;
  const codes = new Set(decision.blockers.map((blocker) => blocker.code));
  const result: MachineShutdownPreparationStep[] = [
    "record_preparation_started",
  ];
  if (codes.has("service_running")) result.push("stop_registered_services");
  if (codes.has("active_tasks_present")) result.push("drain_active_tasks");
  if (codes.has("backup_in_progress")) result.push("complete_backup");
  if (codes.has("filesystem_sync_required"))
    result.push("synchronize_filesystem");
  result.push(
    "record_preparation_completed",
    "reevaluate_readiness",
    "record_final_readiness",
  );
  return result;
}

function isPreparableBlocker(
  blocker: MachineShutdownReadinessBlocker,
): boolean {
  if (blocker.code === "service_running")
    return typeof blocker.serviceId === "string";
  return (
    blocker.code === "active_tasks_present" ||
    blocker.code === "backup_in_progress" ||
    blocker.code === "filesystem_sync_required"
  );
}
export class MachineShutdownPreparationPlanError extends Error {
  public override readonly name = "MachineShutdownPreparationPlanError";
  public constructor(public readonly code: "invalid_plan" | "invalid_step") {
    super(`Invalid machine shutdown preparation plan: ${code}`);
    Object.freeze(this);
  }
}
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
