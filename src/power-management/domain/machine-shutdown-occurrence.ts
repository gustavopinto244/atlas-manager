import { isCanonicalTimestamp } from "./canonical-timestamp.js";

export interface MachineShutdownOccurrence {
  readonly operation: "shutdown";
  readonly scheduledFor: string;
  readonly wakeScheduledFor: string;
}

export type MachineShutdownOccurrenceValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_operation"
  | "invalid_scheduled_for"
  | "invalid_wake_scheduled_for"
  | "invalid_timestamp_order";

export class MachineShutdownOccurrenceValidationError extends Error {
  public override readonly name = "MachineShutdownOccurrenceValidationError";
  public constructor(
    public readonly code: MachineShutdownOccurrenceValidationErrorCode,
  ) {
    super(`Invalid machine shutdown occurrence: ${code}`);
    Object.freeze(this);
  }
}

const FIELDS = Object.freeze(["operation", "scheduledFor", "wakeScheduledFor"]);

export function createMachineShutdownOccurrence(
  input: unknown,
): MachineShutdownOccurrence {
  if (!isRecord(input))
    throw new MachineShutdownOccurrenceValidationError("invalid_record");
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== FIELDS.length ||
    keys.some((key) => typeof key !== "string" || !FIELDS.includes(key))
  ) {
    throw new MachineShutdownOccurrenceValidationError("invalid_field");
  }
  if (input["operation"] !== "shutdown")
    throw new MachineShutdownOccurrenceValidationError("invalid_operation");
  if (!isCanonicalTimestamp(input["scheduledFor"]))
    throw new MachineShutdownOccurrenceValidationError("invalid_scheduled_for");
  if (!isCanonicalTimestamp(input["wakeScheduledFor"]))
    throw new MachineShutdownOccurrenceValidationError(
      "invalid_wake_scheduled_for",
    );
  if (
    Date.parse(input["scheduledFor"]) >= Date.parse(input["wakeScheduledFor"])
  ) {
    throw new MachineShutdownOccurrenceValidationError(
      "invalid_timestamp_order",
    );
  }
  return Object.freeze({
    operation: "shutdown" as const,
    scheduledFor: input["scheduledFor"],
    wakeScheduledFor: input["wakeScheduledFor"],
  });
}

export function isSameMachineShutdownOccurrence(
  left: MachineShutdownOccurrence,
  right: MachineShutdownOccurrence,
): boolean {
  return (
    left.operation === right.operation &&
    left.scheduledFor === right.scheduledFor &&
    left.wakeScheduledFor === right.wakeScheduledFor
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
