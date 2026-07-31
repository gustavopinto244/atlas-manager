import type { MachinePowerSchedulerCursor } from "./machine-power-scheduler-cursor.js";
import type { MachinePowerSchedulerReport } from "./machine-power-scheduler-report.js";
import type { MachineShutdownOccurrenceClaimPruningResult } from "./machine-shutdown-occurrence-claim-pruning-result.js";

export type MachinePowerSchedulerResult =
  | Readonly<{ kind: "initialized"; cursor: MachinePowerSchedulerCursor }>
  | Readonly<{
      kind: "idle" | "blocked";
      cursor: MachinePowerSchedulerCursor;
      tickedAt: string;
      reason?: "clock_regression" | "interval_too_large";
    }>
  | Readonly<{
      kind: "incomplete" | "advanced";
      previousCursor: MachinePowerSchedulerCursor;
      cursor?: MachinePowerSchedulerCursor;
      report: MachinePowerSchedulerReport;
      claimPruningResult: MachineShutdownOccurrenceClaimPruningResult;
    }>
  | Readonly<{
      kind: "conflict";
      previousCursor: MachinePowerSchedulerCursor | null;
      attemptedCursor: MachinePowerSchedulerCursor;
      authoritativeCursor: MachinePowerSchedulerCursor | null;
      report: MachinePowerSchedulerReport;
      claimPruningResult?: MachineShutdownOccurrenceClaimPruningResult;
    }>;
