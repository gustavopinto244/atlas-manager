import { isCanonicalTimestamp } from "./canonical-timestamp.js";

export interface MachineShutdownResult {
  readonly operation: "shutdown";
  readonly requestedAt: string;
  readonly outcome: "simulated";
}

export type MachineShutdownResultValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_operation"
  | "invalid_requested_at"
  | "invalid_outcome";

export class MachineShutdownResultValidationError extends Error {
  public override readonly name = "MachineShutdownResultValidationError";

  public constructor(
    public readonly code: MachineShutdownResultValidationErrorCode,
  ) {
    super(`Invalid machine shutdown result: ${code}`);
    Object.freeze(this);
  }
}

export function createMachineShutdownResult(
  input: unknown,
): MachineShutdownResult {
  if (!isRecord(input)) {
    throw new MachineShutdownResultValidationError("invalid_record");
  }

  const fields = Object.keys(input);
  if (
    fields.some(
      (field) =>
        field !== "operation" && field !== "requestedAt" && field !== "outcome",
    )
  ) {
    throw new MachineShutdownResultValidationError("invalid_field");
  }

  if (input["operation"] !== "shutdown") {
    throw new MachineShutdownResultValidationError("invalid_operation");
  }
  if (!isCanonicalTimestamp(input["requestedAt"])) {
    throw new MachineShutdownResultValidationError("invalid_requested_at");
  }
  if (input["outcome"] !== "simulated") {
    throw new MachineShutdownResultValidationError("invalid_outcome");
  }

  return Object.freeze({
    operation: "shutdown" as const,
    requestedAt: input["requestedAt"],
    outcome: "simulated" as const,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
