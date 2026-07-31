import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  createWakeAlarmState,
  WakeAlarmStateValidationError,
  type WakeAlarmState,
} from "./wake-alarm-state.js";

export type WakeAlarmMutationOperation = "schedule" | "cancel";

export type WakeAlarmMutationOutcome =
  "scheduled" | "replaced" | "unchanged" | "cancelled" | "not_scheduled";

export interface WakeAlarmMutationResult {
  readonly operation: WakeAlarmMutationOperation;
  readonly requestedAt: string;
  readonly outcome: WakeAlarmMutationOutcome;
  readonly before: WakeAlarmState;
  readonly after: WakeAlarmState;
}

export type WakeAlarmMutationResultValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_operation"
  | "invalid_requested_at"
  | "invalid_outcome"
  | "invalid_before"
  | "invalid_after"
  | "unsupported_state"
  | "invalid_transition";

export class WakeAlarmMutationResultValidationError extends Error {
  public override readonly name = "WakeAlarmMutationResultValidationError";

  public constructor(
    public readonly code: WakeAlarmMutationResultValidationErrorCode,
  ) {
    super(`Invalid wake-alarm mutation result: ${code}`);
    Object.freeze(this);
  }
}

export function createWakeAlarmMutationResult(
  input: unknown,
): WakeAlarmMutationResult {
  if (!isRecord(input)) {
    throw new WakeAlarmMutationResultValidationError("invalid_record");
  }

  const fields = Object.keys(input);
  if (
    fields.some(
      (field) =>
        field !== "operation" &&
        field !== "requestedAt" &&
        field !== "outcome" &&
        field !== "before" &&
        field !== "after",
    )
  ) {
    throw new WakeAlarmMutationResultValidationError("invalid_field");
  }

  const operation = input["operation"];
  if (operation !== "schedule" && operation !== "cancel") {
    throw new WakeAlarmMutationResultValidationError("invalid_operation");
  }
  if (!isCanonicalTimestamp(input["requestedAt"])) {
    throw new WakeAlarmMutationResultValidationError("invalid_requested_at");
  }

  const outcome = input["outcome"];
  if (
    outcome !== "scheduled" &&
    outcome !== "replaced" &&
    outcome !== "unchanged" &&
    outcome !== "cancelled" &&
    outcome !== "not_scheduled"
  ) {
    throw new WakeAlarmMutationResultValidationError("invalid_outcome");
  }

  const before = createState(input["before"], "invalid_before");
  const after = createState(input["after"], "invalid_after");
  if (before.state === "unsupported" || after.state === "unsupported") {
    throw new WakeAlarmMutationResultValidationError("unsupported_state");
  }

  if (!isValidTransition(operation, outcome, before, after)) {
    throw new WakeAlarmMutationResultValidationError("invalid_transition");
  }

  return Object.freeze({
    operation,
    requestedAt: input["requestedAt"],
    outcome,
    before,
    after,
  });
}

function createState(
  input: unknown,
  invalidCode: "invalid_before" | "invalid_after",
): WakeAlarmState {
  try {
    return createWakeAlarmState(input);
  } catch (error) {
    if (error instanceof WakeAlarmStateValidationError) {
      throw new WakeAlarmMutationResultValidationError(invalidCode);
    }
    throw error;
  }
}

function isValidTransition(
  operation: WakeAlarmMutationOperation,
  outcome: WakeAlarmMutationOutcome,
  before: WakeAlarmState,
  after: WakeAlarmState,
): boolean {
  if (operation === "schedule") {
    if (outcome === "scheduled") {
      return before.state === "not_scheduled" && after.state === "scheduled";
    }
    if (outcome === "replaced") {
      return (
        before.state === "scheduled" &&
        after.state === "scheduled" &&
        before.scheduledFor !== after.scheduledFor
      );
    }
    if (outcome === "unchanged") {
      return (
        before.state === "scheduled" &&
        after.state === "scheduled" &&
        before.scheduledFor === after.scheduledFor
      );
    }
    return false;
  }

  if (outcome === "cancelled") {
    return before.state === "scheduled" && after.state === "not_scheduled";
  }
  if (outcome === "not_scheduled") {
    return before.state === "not_scheduled" && after.state === "not_scheduled";
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
