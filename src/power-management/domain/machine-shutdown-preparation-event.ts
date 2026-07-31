/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "./machine-shutdown-occurrence.js";
import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  MACHINE_SHUTDOWN_BLOCKER_CODES,
  type MachineShutdownBlockerCode,
} from "./machine-shutdown-readiness-blocker.js";
import {
  MACHINE_SHUTDOWN_PREPARATION_STEPS,
  type MachineShutdownPreparationStep,
} from "./machine-shutdown-preparation-plan.js";
export const MACHINE_SHUTDOWN_PREPARATION_EVENT_KINDS = Object.freeze([
  "preparation_started",
  "services_prepared",
  "active_tasks_prepared",
  "backup_prepared",
  "filesystem_prepared",
  "preparation_completed",
  "preparation_failed",
  "final_readiness_approved",
  "final_readiness_rejected",
] as const);
export type MachineShutdownPreparationEventKind =
  (typeof MACHINE_SHUTDOWN_PREPARATION_EVENT_KINDS)[number];
export interface MachineShutdownPreparationEvent {
  readonly sequence: number;
  readonly kind: MachineShutdownPreparationEventKind;
  readonly occurrence: MachineShutdownOccurrence;
  readonly occurredAt: string;
  readonly stoppedCount?: number;
  readonly alreadyStoppedCount?: number;
  readonly outcome?: string;
  readonly failedStep?: string;
  readonly failureCode?: string;
  readonly blockerCodes?: readonly string[];
}
export function createMachineShutdownPreparationEvent(
  input: unknown,
): MachineShutdownPreparationEvent {
  if (
    !isRecord(input) ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 1 ||
    !MACHINE_SHUTDOWN_PREPARATION_EVENT_KINDS.includes(
      input.kind as MachineShutdownPreparationEventKind,
    ) ||
    !isCanonicalTimestamp(input.occurredAt)
  )
    throw new MachineShutdownPreparationEventError();
  let occurrence: MachineShutdownOccurrence;
  try {
    occurrence = createMachineShutdownOccurrence(input.occurrence);
  } catch {
    throw new MachineShutdownPreparationEventError();
  }
  const allowed = new Set([
    "sequence",
    "kind",
    "occurrence",
    "occurredAt",
    "stoppedCount",
    "alreadyStoppedCount",
    "outcome",
    "failedStep",
    "failureCode",
    "blockerCodes",
  ]);
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || !allowed.has(key),
    )
  )
    throw new MachineShutdownPreparationEventError();
  const detailKeys = new Set(["sequence", "kind", "occurrence", "occurredAt"]);
  const detailByKind: Record<
    MachineShutdownPreparationEventKind,
    readonly string[]
  > = {
    preparation_started: [],
    preparation_completed: [],
    final_readiness_approved: [],
    services_prepared: ["stoppedCount", "alreadyStoppedCount"],
    active_tasks_prepared: ["outcome"],
    backup_prepared: ["outcome"],
    filesystem_prepared: ["outcome"],
    preparation_failed: ["failedStep", "failureCode"],
    final_readiness_rejected: ["blockerCodes"],
  };
  for (const key of detailByKind[
    input.kind as MachineShutdownPreparationEventKind
  ])
    detailKeys.add(key);
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || !detailKeys.has(key),
    )
  )
    throw new MachineShutdownPreparationEventError();
  if (
    ["services_prepared"].includes(input.kind as string) &&
    (!Number.isInteger(input.stoppedCount) ||
      (input.stoppedCount as number) < 0 ||
      !Number.isInteger(input.alreadyStoppedCount) ||
      (input.alreadyStoppedCount as number) < 0)
  )
    throw new MachineShutdownPreparationEventError();
  const outcomes: Record<string, readonly string[]> = {
    active_tasks_prepared: ["drained", "already_drained"],
    backup_prepared: ["completed", "not_running"],
    filesystem_prepared: ["synchronized", "already_synchronized"],
  };
  const acceptedOutcomes = outcomes[String(input.kind)] ?? [];
  if (
    acceptedOutcomes.length > 0 &&
    !acceptedOutcomes.includes(String(input.outcome))
  )
    throw new MachineShutdownPreparationEventError();
  if (
    input.kind === "preparation_failed" &&
    (typeof input.failedStep !== "string" ||
      !MACHINE_SHUTDOWN_PREPARATION_STEPS.includes(
        input.failedStep as MachineShutdownPreparationStep,
      ) ||
      typeof input.failureCode !== "string" ||
      !isSafeFailureCode(input.failureCode))
  )
    throw new MachineShutdownPreparationEventError();
  if (
    input.kind === "final_readiness_rejected" &&
    (!Array.isArray(input.blockerCodes) ||
      input.blockerCodes.length < 1 ||
      input.blockerCodes.some(
        (code) =>
          !MACHINE_SHUTDOWN_BLOCKER_CODES.includes(
            code as MachineShutdownBlockerCode,
          ),
      ))
  )
    throw new MachineShutdownPreparationEventError();
  if (
    Object.hasOwn(input, "blockerCodes") &&
    (!Array.isArray(input.blockerCodes) ||
      input.blockerCodes.some((code) => typeof code !== "string"))
  )
    throw new MachineShutdownPreparationEventError();
  return Object.freeze({
    ...input,
    occurrence,
    ...(Array.isArray(input.blockerCodes)
      ? { blockerCodes: Object.freeze([...input.blockerCodes]) }
      : {}),
  }) as MachineShutdownPreparationEvent;
}

function isSafeFailureCode(value: string): boolean {
  return [
    "active_tasks_present",
    "backup_completion_failed",
    "backup_completion_unknown",
    "event_recording_failed",
    "filesystem_synchronization_failed",
    "filesystem_synchronization_unknown",
    "preparation_dependency_failed",
    "service_preparation_failed",
    "service_status_failed",
    "service_stop_failed",
    "service_stop_not_supported",
    "service_plan_invalid",
  ].includes(value);
}
export class MachineShutdownPreparationEventError extends Error {
  public override readonly name = "MachineShutdownPreparationEventError";
  public constructor() {
    super("Invalid machine shutdown preparation event");
    Object.freeze(this);
  }
}
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
