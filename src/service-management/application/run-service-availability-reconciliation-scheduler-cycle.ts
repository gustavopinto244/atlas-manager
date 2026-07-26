import type { Clock } from "./ports/clock.js";
import type { ServiceAvailabilityReconciliationSchedulerCursorStore } from "./ports/service-availability-reconciliation-scheduler-cursor-store.js";
import type {
  PruneExpiredRegisteredServiceAvailabilityOverrides,
  PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult,
} from "./prune-expired-registered-service-availability-overrides.js";
import type {
  RunServiceAvailabilityReconciliationTick,
  ServiceAvailabilityReconciliationTickServiceResult,
} from "./run-service-availability-reconciliation-tick.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../domain/service-availability-reconciliation-scheduler-cursor.js";

const MINUTE_IN_MILLISECONDS = 60_000;
const MAXIMUM_INTERVAL_IN_MILLISECONDS = 8 * 24 * 60 * MINUTE_IN_MILLISECONDS;

export type ServiceAvailabilityReconciliationSchedulerCycleErrorCode =
  "invalid_clock_time" | "clock_before_cursor";

export class ServiceAvailabilityReconciliationSchedulerCycleError extends Error {
  public override readonly name =
    "ServiceAvailabilityReconciliationSchedulerCycleError";

  public constructor(
    public readonly code: ServiceAvailabilityReconciliationSchedulerCycleErrorCode,
  ) {
    super(
      `Service availability reconciliation scheduler cycle failed: ${code}`,
    );
  }
}

export type ServiceAvailabilityReconciliationSchedulerCycleResult =
  | Readonly<{
      kind: "idle";
      cursor: ServiceAvailabilityReconciliationSchedulerCursor;
    }>
  | Readonly<{
      kind: "incomplete";
      cursor: ServiceAvailabilityReconciliationSchedulerCursor | null;
      report: readonly ServiceAvailabilityReconciliationTickServiceResult[];
      pruningReport: readonly PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[];
    }>
  | Readonly<{
      kind: "advanced";
      cursor: ServiceAvailabilityReconciliationSchedulerCursor;
      report: readonly ServiceAvailabilityReconciliationTickServiceResult[];
      pruningReport: readonly PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[];
    }>
  | Readonly<{
      kind: "conflict";
      cursor: ServiceAvailabilityReconciliationSchedulerCursor | null;
      report: readonly ServiceAvailabilityReconciliationTickServiceResult[];
      pruningReport: readonly PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[];
    }>;

export class RunServiceAvailabilityReconciliationSchedulerCycle {
  public constructor(
    private readonly clock: Clock,
    private readonly cursorStore: ServiceAvailabilityReconciliationSchedulerCursorStore,
    private readonly runTick: RunServiceAvailabilityReconciliationTick,
    private readonly pruneExpiredOverrides: PruneExpiredRegisteredServiceAvailabilityOverrides,
  ) {}

  public async execute(): Promise<ServiceAvailabilityReconciliationSchedulerCycleResult> {
    const currentCursor = await this.cursorStore.read();
    const clockTime: unknown = this.clock.now();
    const targetTimestamp = getCanonicalTargetTimestamp(clockTime);

    if (currentCursor !== null) {
      const currentTimestamp = Date.parse(currentCursor.completedThrough);

      if (targetTimestamp < currentTimestamp) {
        throw new ServiceAvailabilityReconciliationSchedulerCycleError(
          "clock_before_cursor",
        );
      }

      if (targetTimestamp === currentTimestamp) {
        return Object.freeze({
          kind: "idle",
          cursor: currentCursor,
        });
      }
    }

    const fromTimestamp =
      currentCursor === null
        ? targetTimestamp - MINUTE_IN_MILLISECONDS
        : Date.parse(currentCursor.completedThrough);
    const toTimestamp = Math.min(
      targetTimestamp,
      fromTimestamp + MAXIMUM_INTERVAL_IN_MILLISECONDS,
    );
    const fromExclusive = new Date(fromTimestamp);
    const toInclusive = new Date(toTimestamp);
    const report = await this.runTick.execute(fromExclusive, toInclusive);
    const pruningReport = await this.pruneExpiredOverrides.execute();

    if (
      isIncompleteReconciliationReport(report) ||
      isIncompletePruningReport(pruningReport)
    ) {
      return Object.freeze({
        kind: "incomplete",
        cursor: currentCursor,
        report,
        pruningReport,
      });
    }

    const candidateCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: toInclusive.toISOString(),
      });
    const advanceResult = await this.cursorStore.advance(
      currentCursor,
      candidateCursor,
    );

    if (advanceResult.kind === "advanced") {
      return Object.freeze({
        kind: "advanced",
        cursor: advanceResult.cursor,
        report,
        pruningReport,
      });
    }

    return Object.freeze({
      kind: "conflict",
      cursor: advanceResult.cursor,
      report,
      pruningReport,
    });
  }
}

function getCanonicalTargetTimestamp(clockTime: unknown): number {
  if (!(clockTime instanceof Date) || !Number.isFinite(clockTime.getTime())) {
    throw new ServiceAvailabilityReconciliationSchedulerCycleError(
      "invalid_clock_time",
    );
  }

  return (
    Math.floor(clockTime.getTime() / MINUTE_IN_MILLISECONDS) *
    MINUTE_IN_MILLISECONDS
  );
}

function isIncompleteReconciliationReport(
  report: readonly ServiceAvailabilityReconciliationTickServiceResult[],
): boolean {
  return report.some(
    (serviceResult) =>
      serviceResult.kind === "failed" ||
      serviceResult.occurrenceResults.some(
        (occurrenceResult) => occurrenceResult.kind === "failed",
      ),
  );
}

function isIncompletePruningReport(
  report: readonly PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[],
): boolean {
  return report.some((serviceResult) => serviceResult.kind === "failed");
}
