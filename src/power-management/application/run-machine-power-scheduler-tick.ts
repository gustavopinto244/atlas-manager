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
import type { AdministrativeAuditTrail } from "../../event-history/application/administrative-audit-trail.js";
import {
  AdministrativeAuditPartialEffectError,
  type AdministrativeAuditTrailError,
} from "../../event-history/application/administrative-audit-trail.js";
import {
  MACHINE_AUDIT_TARGET,
  SCHEDULER_POWER_AUDIT_SOURCE,
} from "./administrative-audit-context.js";

const MAX_INTERVAL = 8 * 24 * 60 * 60 * 1000;
export class RunMachinePowerSchedulerTick {
  readonly #clock: PowerManagementClock;
  readonly #policy: MachineOperatingPolicy;
  readonly #cursorStore: MachinePowerSchedulerCursorStore;
  readonly #claims: MachineShutdownOccurrenceClaimStore;
  readonly #executor: MachineShutdownOccurrenceExecutor;
  readonly #audit: AdministrativeAuditTrail | undefined;
  public constructor(
    clock: PowerManagementClock,
    policy: MachineOperatingPolicy,
    cursorStore: MachinePowerSchedulerCursorStore,
    claims: MachineShutdownOccurrenceClaimStore,
    executor: MachineShutdownOccurrenceExecutor,
    audit?: AdministrativeAuditTrail,
  ) {
    this.#clock = clock;
    this.#policy = policy;
    this.#cursorStore = cursorStore;
    this.#claims = claims;
    this.#executor = executor;
    this.#audit = audit;
    Object.freeze(this);
  }
  public async execute(): Promise<MachinePowerSchedulerResult> {
    const tickedAt = this.#clock.now().toISOString();
    if (!this.#audit) return this.executeCore(tickedAt);
    const attempt = await this.#audit.begin({
      occurredAt: tickedAt,
      source: SCHEDULER_POWER_AUDIT_SOURCE,
      target: MACHINE_AUDIT_TARGET,
      operation: "run_machine_power_scheduler_tick",
      details: { tickedThrough: tickedAt },
    });
    let result: MachinePowerSchedulerResult;
    try {
      result = await this.executeCore(tickedAt);
    } catch (error) {
      try {
        await this.#audit.complete(attempt, "failed", {
          failureCode: "unexpected_execution_failure",
        });
      } catch {
        // The primary scheduler failure remains authoritative.
      }
      throw error;
    }
    const terminal = mapSchedulerAudit(result, tickedAt);
    try {
      await this.#audit.complete(attempt, terminal.status, terminal.details);
    } catch (error) {
      if (isAuditError(error) && hasSchedulerEffect(result))
        throw new AdministrativeAuditPartialEffectError(
          "audit_failed_after_scheduler_tick",
          result,
        );
      throw error;
    }
    return result;
  }

  private async executeCore(
    tickedAt: string,
  ): Promise<MachinePowerSchedulerResult> {
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
        const execution = this.#executor.executeAt
          ? await this.#executor.executeAt(
              occurrence,
              tickedAt,
              SCHEDULER_POWER_AUDIT_SOURCE,
            )
          : await this.#executor.execute(occurrence);
        if (execution.outcome === "rejected")
          items.push({
            kind: "rejected" as const,
            occurrence,
            decision: execution.decision,
            ...(execution.preparationReport
              ? { preparationReport: execution.preparationReport }
              : {}),
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
        complete: items.every(
          (item) =>
            item.kind === "completed" &&
            item.execution.outcome !== "preparation_incomplete" &&
            item.execution.outcome !== "not_due",
        ),
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
  executeAt?(
    occurrence: unknown,
    processedAt: string,
    source: typeof SCHEDULER_POWER_AUDIT_SOURCE,
  ): Promise<MachineShutdownOccurrenceExecutionResult>;
}

function mapSchedulerAudit(
  result: MachinePowerSchedulerResult,
  tickedAt: string,
): {
  readonly status: "succeeded" | "rejected";
  readonly details: Record<string, unknown>;
} {
  if (
    result.kind === "initialized" ||
    result.kind === "idle" ||
    result.kind === "advanced"
  )
    return {
      status: "succeeded",
      details: {
        schedulerOutcome: result.kind,
        tickedThrough: tickedAt,
        complete: result.kind !== "advanced" || result.report.complete,
        ...(result.kind === "advanced"
          ? {
              completedThrough: result.cursor?.completedThrough ?? tickedAt,
              occurrenceCount: result.report.occurrenceResults.length,
            }
          : {}),
      },
    };
  return {
    status: "rejected",
    details: {
      schedulerOutcome: result.kind,
      tickedThrough: tickedAt,
      ...(result.kind === "incomplete" || result.kind === "conflict"
        ? {
            ...(result.previousCursor
              ? { completedThrough: result.previousCursor.completedThrough }
              : {}),
            occurrenceCount: result.report.occurrenceResults.length,
          }
        : {}),
    },
  };
}

function hasSchedulerEffect(result: MachinePowerSchedulerResult): boolean {
  return result.kind === "initialized" || result.kind === "advanced";
}

function isAuditError(error: unknown): error is AdministrativeAuditTrailError {
  return (
    error instanceof Error && error.name === "AdministrativeAuditTrailError"
  );
}
function emptyReport(tickedAt: string): MachinePowerSchedulerReport {
  return createMachinePowerSchedulerReport({
    completedThrough: tickedAt,
    tickedThrough: tickedAt,
    occurrenceResults: [],
    complete: true,
  });
}
