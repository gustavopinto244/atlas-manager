import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "./machine-shutdown-occurrence.js";
import {
  createWakeAlarmMutationResult,
  type WakeAlarmMutationResult,
} from "./wake-alarm-mutation-result.js";
import {
  createMachineShutdownResult,
  type MachineShutdownResult,
} from "./machine-shutdown-result.js";
import type { MachineShutdownReadinessDecision } from "./machine-shutdown-readiness-decision.js";
import { createMachineShutdownReadinessDecision } from "./machine-shutdown-readiness-decision.js";
import type { MachineShutdownPreparationReport } from "./machine-shutdown-preparation-report.js";
import { createMachineShutdownPreparationReport } from "./machine-shutdown-preparation-report.js";

export type MachineShutdownOccurrenceExecutionResult =
  | Readonly<{
      occurrence: MachineShutdownOccurrence;
      processedAt: string;
      outcome: "not_due" | "stale" | "duplicate";
    }>
  | Readonly<{
      occurrence: MachineShutdownOccurrence;
      processedAt: string;
      outcome: "rejected";
      decision: MachineShutdownReadinessDecision;
      preparationReport?: MachineShutdownPreparationReport;
    }>
  | Readonly<{
      occurrence: MachineShutdownOccurrence;
      processedAt: string;
      outcome: "preparation_incomplete";
      preparationReport: MachineShutdownPreparationReport;
    }>
  | Readonly<{
      occurrence: MachineShutdownOccurrence;
      processedAt: string;
      outcome: "executed";
      wakeAlarmMutation: WakeAlarmMutationResult;
      shutdownResult: MachineShutdownResult;
      preparationReport?: MachineShutdownPreparationReport;
    }>;

export class MachineShutdownOccurrenceExecutionResultValidationError extends Error {
  public override readonly name =
    "MachineShutdownOccurrenceExecutionResultValidationError";
  public constructor(
    public readonly code:
      | "invalid_record"
      | "invalid_field"
      | "invalid_occurrence"
      | "invalid_processed_at"
      | "invalid_outcome"
      | "missing_effect"
      | "unexpected_effect"
      | "invalid_effect",
  ) {
    super(`Invalid machine shutdown occurrence execution result: ${code}`);
    Object.freeze(this);
  }
}

export function createMachineShutdownOccurrenceExecutionResult(
  input: unknown,
): MachineShutdownOccurrenceExecutionResult {
  if (!isRecord(input))
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_record",
    );
  const keys = Reflect.ownKeys(input);
  const base = ["occurrence", "processedAt", "outcome"];
  const allowed = [
    ...base,
    "wakeAlarmMutation",
    "shutdownResult",
    "decision",
    "preparationReport",
  ];
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_field",
    );
  let occurrence: MachineShutdownOccurrence;
  try {
    occurrence = createMachineShutdownOccurrence(input["occurrence"]);
  } catch {
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_occurrence",
    );
  }
  if (!isCanonicalTimestamp(input["processedAt"]))
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_processed_at",
    );
  const outcome = input["outcome"];
  if (
    outcome !== "not_due" &&
    outcome !== "stale" &&
    outcome !== "duplicate" &&
    outcome !== "rejected" &&
    outcome !== "preparation_incomplete" &&
    outcome !== "executed"
  )
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_outcome",
    );
  const hasWake = Object.hasOwn(input, "wakeAlarmMutation");
  const hasShutdown = Object.hasOwn(input, "shutdownResult");
  const hasDecision = Object.hasOwn(input, "decision");
  const hasPreparation = Object.hasOwn(input, "preparationReport");
  let preparationReport: MachineShutdownPreparationReport | undefined;
  if (hasPreparation) {
    try {
      preparationReport = createMachineShutdownPreparationReport(
        input["preparationReport"],
      );
    } catch {
      throw new MachineShutdownOccurrenceExecutionResultValidationError(
        "invalid_effect",
      );
    }
  }
  if (outcome === "preparation_incomplete") {
    if (!hasPreparation || hasWake || hasShutdown || hasDecision)
      throw new MachineShutdownOccurrenceExecutionResultValidationError(
        "invalid_effect",
      );
    if (preparationReport!.outcome !== "incomplete")
      throw new MachineShutdownOccurrenceExecutionResultValidationError(
        "invalid_effect",
      );
    return Object.freeze({
      occurrence,
      processedAt: input["processedAt"],
      outcome: "preparation_incomplete" as const,
      preparationReport: preparationReport!,
    });
  }
  if (outcome === "rejected") {
    if (hasWake || hasShutdown || !hasDecision)
      throw new MachineShutdownOccurrenceExecutionResultValidationError(
        "invalid_effect",
      );
    let decision: MachineShutdownReadinessDecision;
    try {
      decision = createMachineShutdownReadinessDecision(input["decision"]);
    } catch {
      throw new MachineShutdownOccurrenceExecutionResultValidationError(
        "invalid_effect",
      );
    }
    if (
      decision.outcome !== "rejected" ||
      decision.evaluatedAt !== input["processedAt"] ||
      decision.occurrence.scheduledFor !== occurrence.scheduledFor ||
      decision.occurrence.wakeScheduledFor !== occurrence.wakeScheduledFor
    )
      throw new MachineShutdownOccurrenceExecutionResultValidationError(
        "invalid_effect",
      );
    if (
      preparationReport !== undefined &&
      preparationReport.outcome !== "blocked"
    )
      throw new MachineShutdownOccurrenceExecutionResultValidationError(
        "invalid_effect",
      );
    return Object.freeze({
      occurrence,
      processedAt: input["processedAt"],
      outcome: "rejected" as const,
      decision,
      ...(preparationReport ? { preparationReport } : {}),
    });
  }
  if (outcome !== "executed") {
    if (hasWake || hasShutdown || hasDecision || hasPreparation)
      throw new MachineShutdownOccurrenceExecutionResultValidationError(
        "unexpected_effect",
      );
    return Object.freeze({
      occurrence,
      processedAt: input["processedAt"],
      outcome,
    });
  }
  if (!hasWake || !hasShutdown)
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "missing_effect",
    );
  let wake: WakeAlarmMutationResult;
  let shutdown: MachineShutdownResult;
  try {
    wake = createWakeAlarmMutationResult(input["wakeAlarmMutation"]);
    shutdown = createMachineShutdownResult(input["shutdownResult"]);
  } catch {
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_effect",
    );
  }
  if (
    wake.operation !== "schedule" ||
    (wake.outcome !== "scheduled" &&
      wake.outcome !== "replaced" &&
      wake.outcome !== "unchanged") ||
    wake.requestedAt !== input["processedAt"] ||
    wake.after.state !== "scheduled" ||
    wake.after.scheduledFor !== occurrence.wakeScheduledFor ||
    shutdown.requestedAt !== input["processedAt"]
  )
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_effect",
    );
  if (
    preparationReport !== undefined &&
    preparationReport.outcome !== "not_required" &&
    preparationReport.outcome !== "prepared"
  )
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_effect",
    );
  return Object.freeze({
    occurrence,
    processedAt: input["processedAt"],
    outcome: "executed" as const,
    wakeAlarmMutation: wake,
    shutdownResult: shutdown,
    ...(preparationReport ? { preparationReport } : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
