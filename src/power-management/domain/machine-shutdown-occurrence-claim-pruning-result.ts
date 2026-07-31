export type MachineShutdownOccurrenceClaimPruningResult = Readonly<{
  outcome: "pruned" | "unchanged";
}>;
export class MachineShutdownOccurrenceClaimPruningResultValidationError extends Error {
  public override readonly name =
    "MachineShutdownOccurrenceClaimPruningResultValidationError";
  public constructor(
    public readonly code:
      "invalid_record" | "invalid_field" | "invalid_outcome",
  ) {
    super(`Invalid machine shutdown occurrence claim pruning result: ${code}`);
    Object.freeze(this);
  }
}
export function createMachineShutdownOccurrenceClaimPruningResult(
  input: unknown,
): MachineShutdownOccurrenceClaimPruningResult {
  if (!isRecord(input))
    throw new MachineShutdownOccurrenceClaimPruningResultValidationError(
      "invalid_record",
    );
  if (Reflect.ownKeys(input).length !== 1 || !Object.hasOwn(input, "outcome"))
    throw new MachineShutdownOccurrenceClaimPruningResultValidationError(
      "invalid_field",
    );
  if (input["outcome"] !== "pruned" && input["outcome"] !== "unchanged")
    throw new MachineShutdownOccurrenceClaimPruningResultValidationError(
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
