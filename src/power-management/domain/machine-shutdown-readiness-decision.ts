import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "./machine-shutdown-occurrence.js";
import {
  createMachineShutdownReadinessBlocker,
  sortMachineShutdownReadinessBlockers,
  type MachineShutdownReadinessBlocker,
} from "./machine-shutdown-readiness-blocker.js";
import { isCanonicalTimestamp } from "./canonical-timestamp.js";

export type MachineShutdownReadinessDecision =
  | Readonly<{
      occurrence: MachineShutdownOccurrence;
      evaluatedAt: string;
      outcome: "approved";
      blockers: readonly [];
    }>
  | Readonly<{
      occurrence: MachineShutdownOccurrence;
      evaluatedAt: string;
      outcome: "rejected";
      blockers: readonly MachineShutdownReadinessBlocker[];
    }>;
export class MachineShutdownReadinessDecisionValidationError extends Error {
  public override readonly name =
    "MachineShutdownReadinessDecisionValidationError";
  public constructor(
    public readonly code:
      | "invalid_record"
      | "invalid_field"
      | "invalid_occurrence"
      | "invalid_evaluated_at"
      | "invalid_outcome"
      | "invalid_blockers",
  ) {
    super(`Invalid machine shutdown readiness decision: ${code}`);
    Object.freeze(this);
  }
}
export function createMachineShutdownReadinessDecision(
  input: unknown,
): MachineShutdownReadinessDecision {
  if (!isRecord(input))
    throw new MachineShutdownReadinessDecisionValidationError("invalid_record");
  const allowed = ["occurrence", "evaluatedAt", "outcome", "blockers"];
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    )
  )
    throw new MachineShutdownReadinessDecisionValidationError("invalid_field");
  let occurrence;
  try {
    occurrence = createMachineShutdownOccurrence(input["occurrence"]);
  } catch {
    throw new MachineShutdownReadinessDecisionValidationError(
      "invalid_occurrence",
    );
  }
  if (!isCanonicalTimestamp(input["evaluatedAt"]))
    throw new MachineShutdownReadinessDecisionValidationError(
      "invalid_evaluated_at",
    );
  if (input["outcome"] !== "approved" && input["outcome"] !== "rejected")
    throw new MachineShutdownReadinessDecisionValidationError(
      "invalid_outcome",
    );
  if (!Array.isArray(input["blockers"]))
    throw new MachineShutdownReadinessDecisionValidationError(
      "invalid_blockers",
    );
  let blockers: readonly MachineShutdownReadinessBlocker[];
  try {
    blockers = sortMachineShutdownReadinessBlockers(
      input["blockers"].map(createMachineShutdownReadinessBlocker),
    );
  } catch {
    throw new MachineShutdownReadinessDecisionValidationError(
      "invalid_blockers",
    );
  }
  if (input["outcome"] === "approved" && blockers.length !== 0)
    throw new MachineShutdownReadinessDecisionValidationError(
      "invalid_blockers",
    );
  if (input["outcome"] === "rejected" && blockers.length === 0)
    throw new MachineShutdownReadinessDecisionValidationError(
      "invalid_blockers",
    );
  if (input["outcome"] === "approved")
    return Object.freeze({
      occurrence,
      evaluatedAt: input["evaluatedAt"],
      outcome: "approved" as const,
      blockers: [] as const,
    });
  return Object.freeze({
    occurrence,
    evaluatedAt: input["evaluatedAt"],
    outcome: "rejected" as const,
    blockers,
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
