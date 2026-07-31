import { isCanonicalTimestamp } from "./canonical-timestamp.js";
export {
  createMachinePowerSchedulerCursorAdvanceResult,
  MachinePowerSchedulerCursorAdvanceResultValidationError,
} from "./machine-power-scheduler-cursor-result.js";
export type { MachinePowerSchedulerCursorAdvanceResult } from "./machine-power-scheduler-cursor-result.js";

export interface MachinePowerSchedulerCursor {
  readonly completedThrough: string;
}
export class MachinePowerSchedulerCursorValidationError extends Error {
  public override readonly name = "MachinePowerSchedulerCursorValidationError";
  public constructor(
    public readonly code:
      "invalid_record" | "invalid_field" | "invalid_completed_through",
  ) {
    super(`Invalid machine power scheduler cursor: ${code}`);
    Object.freeze(this);
  }
}
export function createMachinePowerSchedulerCursor(
  input: unknown,
): MachinePowerSchedulerCursor {
  if (!isRecord(input))
    throw new MachinePowerSchedulerCursorValidationError("invalid_record");
  if (
    Reflect.ownKeys(input).length !== 1 ||
    !Object.hasOwn(input, "completedThrough")
  )
    throw new MachinePowerSchedulerCursorValidationError("invalid_field");
  if (!isCanonicalTimestamp(input["completedThrough"]))
    throw new MachinePowerSchedulerCursorValidationError(
      "invalid_completed_through",
    );
  return Object.freeze({ completedThrough: input["completedThrough"] });
}
export function isSameMachinePowerSchedulerCursor(
  left: MachinePowerSchedulerCursor | null,
  right: MachinePowerSchedulerCursor | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.completedThrough === right.completedThrough;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
