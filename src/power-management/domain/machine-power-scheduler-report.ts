import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "./machine-shutdown-occurrence.js";
import type { MachineShutdownOccurrenceExecutionResult } from "./machine-shutdown-occurrence-execution-result.js";

export type MachinePowerSchedulerItem =
  | Readonly<{
      kind: "completed";
      execution: MachineShutdownOccurrenceExecutionResult;
    }>
  | Readonly<{
      kind: "failed";
      occurrence: MachineShutdownOccurrence;
      failureCode:
        | "claim_failed"
        | "wake_alarm_preparation_failed"
        | "shutdown_failed_after_wake_scheduled"
        | "unexpected_execution_failure";
    }>;
export interface MachinePowerSchedulerReport {
  readonly completedThrough: string;
  readonly tickedThrough: string;
  readonly occurrenceResults: readonly MachinePowerSchedulerItem[];
  readonly complete: boolean;
}
export function createMachinePowerSchedulerItem(
  input: unknown,
): MachinePowerSchedulerItem {
  if (!isRecord(input)) throw new Error("invalid scheduler item");
  if (input["kind"] === "completed" && Object.hasOwn(input, "execution"))
    return Object.freeze({
      kind: "completed" as const,
      execution: input["execution"] as MachineShutdownOccurrenceExecutionResult,
    });
  if (
    input["kind"] === "failed" &&
    Object.hasOwn(input, "occurrence") &&
    Object.hasOwn(input, "failureCode")
  ) {
    const occurrence = createMachineShutdownOccurrence(input["occurrence"]);
    const code = input["failureCode"];
    if (
      code === "claim_failed" ||
      code === "wake_alarm_preparation_failed" ||
      code === "shutdown_failed_after_wake_scheduled" ||
      code === "unexpected_execution_failure"
    )
      return Object.freeze({
        kind: "failed" as const,
        occurrence,
        failureCode: code,
      });
  }
  throw new Error("invalid scheduler item");
}
export function createMachinePowerSchedulerReport(
  input: unknown,
): MachinePowerSchedulerReport {
  if (
    !isRecord(input) ||
    !isCanonicalTimestamp(input["completedThrough"]) ||
    !isCanonicalTimestamp(input["tickedThrough"]) ||
    !Array.isArray(input["occurrenceResults"])
  )
    throw new Error("invalid scheduler report");
  const occurrenceResults = Object.freeze(
    input["occurrenceResults"].map(createMachinePowerSchedulerItem),
  );
  const complete = occurrenceResults.every((item) => item.kind === "completed");
  if (
    input["complete"] !== complete ||
    Date.parse(input["completedThrough"]) > Date.parse(input["tickedThrough"])
  )
    throw new Error("invalid scheduler report");
  return Object.freeze({
    completedThrough: input["completedThrough"],
    tickedThrough: input["tickedThrough"],
    occurrenceResults,
    complete,
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
