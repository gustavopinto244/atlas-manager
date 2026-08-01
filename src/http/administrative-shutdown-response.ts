import type { MachineShutdownOccurrenceExecutionResult } from "../power-management/domain/machine-shutdown-occurrence-execution-result.js";
import type { MachineShutdownPreparationReport } from "../power-management/domain/machine-shutdown-preparation-report.js";
import type { MachineShutdownReadinessBlocker } from "../power-management/domain/machine-shutdown-readiness-blocker.js";

export function mapMachineShutdownPreparationResponse(
  report: unknown,
): Record<string, unknown> {
  const value = report as MachineShutdownPreparationReport;
  return Object.freeze({
    occurrence: mapOccurrence(value.occurrence),
    processedAt: value.processedAt,
    outcome: value.outcome,
    completedStepCount: value.steps.filter(
      (step) => step.outcome === "completed",
    ).length,
    blockers: mapBlockers(
      value.finalDecision?.blockers ?? value.initialDecision.blockers,
    ),
  });
}

export function mapMachineShutdownExecutionResponse(
  result: unknown,
): Record<string, unknown> {
  const value = result as MachineShutdownOccurrenceExecutionResult;
  const base: Record<string, unknown> = {
    occurrence: mapOccurrence(value.occurrence),
    processedAt: value.processedAt,
    outcome: value.outcome,
  };
  if (value.outcome === "rejected")
    base.blockers = mapBlockers(value.decision.blockers);
  if (value.outcome === "executed") {
    base.wakeAlarm = Object.freeze({
      outcome: value.wakeAlarmMutation.outcome,
      scheduledFor:
        value.wakeAlarmMutation.after.state === "scheduled"
          ? value.wakeAlarmMutation.after.scheduledFor
          : value.occurrence.wakeScheduledFor,
    });
    base.shutdown = Object.freeze({ outcome: value.shutdownResult.outcome });
  }
  return Object.freeze(base);
}

function mapOccurrence(input: {
  readonly operation: "shutdown";
  readonly scheduledFor: string;
  readonly wakeScheduledFor: string;
}): Record<string, string> {
  return Object.freeze({
    operation: input.operation,
    scheduledFor: input.scheduledFor,
    wakeScheduledFor: input.wakeScheduledFor,
  });
}

function mapBlockers(
  blockers: readonly MachineShutdownReadinessBlocker[],
): readonly Record<string, unknown>[] {
  return Object.freeze(
    blockers.map((blocker) =>
      Object.freeze({
        area: blocker.area,
        code: blocker.code,
        ...(blocker.serviceId === undefined
          ? {}
          : { serviceId: blocker.serviceId }),
        ...(blocker.firstRequiredAt === undefined
          ? {}
          : { firstRequiredAt: blocker.firstRequiredAt }),
        ...(blocker.activeTaskCount === undefined
          ? {}
          : { activeTaskCount: blocker.activeTaskCount }),
      }),
    ),
  );
}
