import {
  createMachinePowerSchedulerCursor,
  type MachinePowerSchedulerCursor,
} from "./machine-power-scheduler-cursor.js";

export type MachinePowerSchedulerCursorAdvanceResult =
  | Readonly<{ kind: "advanced"; cursor: MachinePowerSchedulerCursor }>
  | Readonly<{ kind: "conflict"; cursor: MachinePowerSchedulerCursor | null }>;
export class MachinePowerSchedulerCursorAdvanceResultValidationError extends Error {
  public override readonly name =
    "MachinePowerSchedulerCursorAdvanceResultValidationError";
  public constructor(
    public readonly code:
      "invalid_record" | "invalid_field" | "invalid_kind" | "invalid_cursor",
  ) {
    super(`Invalid machine power scheduler cursor result: ${code}`);
    Object.freeze(this);
  }
}
export function createMachinePowerSchedulerCursorAdvanceResult(
  input: unknown,
): MachinePowerSchedulerCursorAdvanceResult {
  if (!isRecord(input))
    throw new MachinePowerSchedulerCursorAdvanceResultValidationError(
      "invalid_record",
    );
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || (key !== "kind" && key !== "cursor"),
    )
  )
    throw new MachinePowerSchedulerCursorAdvanceResultValidationError(
      "invalid_field",
    );
  if (input["kind"] !== "advanced" && input["kind"] !== "conflict")
    throw new MachinePowerSchedulerCursorAdvanceResultValidationError(
      "invalid_kind",
    );
  if (input["kind"] === "advanced") {
    if (!Object.hasOwn(input, "cursor"))
      throw new MachinePowerSchedulerCursorAdvanceResultValidationError(
        "invalid_cursor",
      );
    return Object.freeze({
      kind: "advanced" as const,
      cursor: createMachinePowerSchedulerCursor(input["cursor"]),
    });
  }
  if (!Object.hasOwn(input, "cursor"))
    throw new MachinePowerSchedulerCursorAdvanceResultValidationError(
      "invalid_cursor",
    );
  const cursor =
    input["cursor"] === null
      ? null
      : createMachinePowerSchedulerCursor(input["cursor"]);
  return Object.freeze({ kind: "conflict" as const, cursor });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
