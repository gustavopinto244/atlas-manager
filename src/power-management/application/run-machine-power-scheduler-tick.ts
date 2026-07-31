import type { PowerManagementClock } from "./ports/power-management-clock.js";
import type { MachinePowerSchedulerCursorStore } from "./ports/machine-power-scheduler-cursor-store.js";
import type { MachineShutdownOccurrenceClaimStore } from "./ports/machine-shutdown-occurrence-claim-store.js";
import type { MachineShutdownOccurrenceExecutionResult } from "../domain/machine-shutdown-occurrence-execution-result.js";
import type { MachineOperatingPolicy } from "../domain/machine-operating-policy.js";
import { createMachinePowerSchedulerCursor } from "../domain/machine-power-scheduler-cursor.js";
import {
  createMachinePowerSchedulerReport,
  type MachinePowerSchedulerReport,
} from "../domain/machine-power-scheduler-report.js";
import type { MachinePowerSchedulerResult } from "../domain/machine-power-scheduler-result.js";
import { createMachineShutdownOccurrencesForInterval } from "../domain/machine-shutdown-occurrence-interval.js";
import { MachineShutdownOccurrenceExecutionError } from "./execute-machine-shutdown-occurrence.js";

const MAX_INTERVAL = 8 * 24 * 60 * 60 * 1000;
export class RunMachinePowerSchedulerTick {
  readonly #clock: PowerManagementClock;
  readonly #policy: MachineOperatingPolicy;
  readonly #cursorStore: MachinePowerSchedulerCursorStore;
  readonly #claims: MachineShutdownOccurrenceClaimStore;
  readonly #executor: MachineShutdownOccurrenceExecutor;
  public constructor(
    clock: PowerManagementClock,
    policy: MachineOperatingPolicy,
    cursorStore: MachinePowerSchedulerCursorStore,
    claims: MachineShutdownOccurrenceClaimStore,
    executor: MachineShutdownOccurrenceExecutor,
  ) {
    this.#clock = clock;
    this.#policy = policy;
    this.#cursorStore = cursorStore;
    this.#claims = claims;
    this.#executor = executor;
    Object.freeze(this);
  }
  public async execute(): Promise<MachinePowerSchedulerResult> {
    const tickedAt = this.#clock.now().toISOString();
    const ticked = createMachinePowerSchedulerCursor({
      completedThrough: tickedAt,
    });
    const current = await this.#cursorStore.read();
    if (current === null) {
      const initialization = await this.#cursorStore.advance(null, ticked);
      if (initialization.kind === "conflict")
        return Object.freeze({
          kind: "conflict" as const,
          previousCursor: null,
          attemptedCursor: ticked,
          authoritativeCursor: initialization.cursor,
          report: emptyReport(tickedAt),
        });
      return Object.freeze({ kind: "initialized" as const, cursor: ticked });
    }
    if (tickedAt === current.completedThrough)
      return Object.freeze({
        kind: "idle" as const,
        cursor: current,
        tickedAt,
      });
    if (tickedAt < current.completedThrough)
      return Object.freeze({
        kind: "blocked" as const,
        cursor: current,
        tickedAt,
        reason: "clock_regression" as const,
      });
    if (
      Date.parse(tickedAt) - Date.parse(current.completedThrough) >
      MAX_INTERVAL
    )
      return Object.freeze({
        kind: "blocked" as const,
        cursor: current,
        tickedAt,
        reason: "interval_too_large" as const,
      });
    const occurrences = createMachineShutdownOccurrencesForInterval(
      this.#policy,
      current.completedThrough,
      tickedAt,
    );
    const items = [];
    for (const occurrence of occurrences) {
      try {
        const execution = await this.#executor.execute(occurrence);
        if (execution.outcome === "rejected")
          items.push({
            kind: "rejected" as const,
            occurrence,
            decision: execution.decision,
          });
        else items.push({ kind: "completed" as const, execution });
      } catch (error) {
        const failureCode =
          error instanceof MachineShutdownOccurrenceExecutionError
            ? error.code
            : "unexpected_execution_failure";
        items.push({ kind: "failed" as const, occurrence, failureCode });
      }
    }
    const report: MachinePowerSchedulerReport =
      createMachinePowerSchedulerReport({
        completedThrough: current.completedThrough,
        tickedThrough: tickedAt,
        occurrenceResults: items,
        complete: items.every((item) => item.kind === "completed"),
      });
    const pruning = await this.#claims.pruneCompletedThrough(current);
    if (!report.complete)
      return Object.freeze({
        kind: "incomplete" as const,
        previousCursor: current,
        report,
        claimPruningResult: pruning,
      });
    const advanced = await this.#cursorStore.advance(current, ticked);
    if (advanced.kind === "conflict")
      return Object.freeze({
        kind: "conflict" as const,
        previousCursor: current,
        attemptedCursor: ticked,
        authoritativeCursor: advanced.cursor,
        report,
        claimPruningResult: pruning,
      });
    return Object.freeze({
      kind: "advanced" as const,
      previousCursor: current,
      cursor: ticked,
      report,
      claimPruningResult: pruning,
    });
  }
}

export interface MachineShutdownOccurrenceExecutor {
  execute(
    occurrence: unknown,
  ): Promise<MachineShutdownOccurrenceExecutionResult>;
}
function emptyReport(tickedAt: string): MachinePowerSchedulerReport {
  return createMachinePowerSchedulerReport({
    completedThrough: tickedAt,
    tickedThrough: tickedAt,
    occurrenceResults: [],
    complete: true,
  });
}
