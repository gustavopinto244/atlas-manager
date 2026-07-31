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

export type MachineShutdownOccurrenceExecutionResult =
  | Readonly<{
      occurrence: MachineShutdownOccurrence;
      processedAt: string;
      outcome: "not_due" | "stale" | "duplicate";
    }>
  | Readonly<{
      occurrence: MachineShutdownOccurrence;
      processedAt: string;
      outcome: "executed";
      wakeAlarmMutation: WakeAlarmMutationResult;
      shutdownResult: MachineShutdownResult;
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
  const allowed = [...base, "wakeAlarmMutation", "shutdownResult"];
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
    outcome !== "executed"
  )
    throw new MachineShutdownOccurrenceExecutionResultValidationError(
      "invalid_outcome",
    );
  const hasWake = Object.hasOwn(input, "wakeAlarmMutation");
  const hasShutdown = Object.hasOwn(input, "shutdownResult");
  if (outcome !== "executed") {
    if (hasWake || hasShutdown)
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
  return Object.freeze({
    occurrence,
    processedAt: input["processedAt"],
    outcome: "executed" as const,
    wakeAlarmMutation: wake,
    shutdownResult: shutdown,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
