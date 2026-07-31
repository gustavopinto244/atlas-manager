export type MachineShutdownOccurrenceClaimOutcome = "claimed" | "duplicate";
export interface MachineShutdownOccurrenceClaimResult {
  readonly outcome: MachineShutdownOccurrenceClaimOutcome;
}
export class MachineShutdownOccurrenceClaimResultValidationError extends Error {
  public override readonly name =
    "MachineShutdownOccurrenceClaimResultValidationError";
  public constructor(
    public readonly code:
      "invalid_record" | "invalid_field" | "invalid_outcome",
  ) {
    super(`Invalid machine shutdown occurrence claim result: ${code}`);
    Object.freeze(this);
  }
}
export function createMachineShutdownOccurrenceClaimResult(
  input: unknown,
): MachineShutdownOccurrenceClaimResult {
  if (!isRecord(input))
    throw new MachineShutdownOccurrenceClaimResultValidationError(
      "invalid_record",
    );
  if (Reflect.ownKeys(input).length !== 1 || !Object.hasOwn(input, "outcome"))
    throw new MachineShutdownOccurrenceClaimResultValidationError(
      "invalid_field",
    );
  if (input["outcome"] !== "claimed" && input["outcome"] !== "duplicate")
    throw new MachineShutdownOccurrenceClaimResultValidationError(
      "invalid_outcome",
    );
  return Object.freeze({ outcome: input["outcome"] });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
