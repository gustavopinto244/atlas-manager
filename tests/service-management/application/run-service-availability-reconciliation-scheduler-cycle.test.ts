import { describe, expect, it, vi } from "vitest";

import { ControlRegisteredService } from "../../../src/service-management/application/control-registered-service.js";
import { ExecuteRegisteredServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.js";
import { GenerateRegisteredServiceAvailabilityReconciliationOccurrences } from "../../../src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.js";
import { ListRegisteredServices } from "../../../src/service-management/application/list-registered-services.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/plan-registered-service-availability-reconciliation.js";
import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import {
  PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
  type PruneCompletedServiceAvailabilityReconciliationOccurrenceClaimsResult,
} from "../../../src/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.js";
import {
  PruneExpiredRegisteredServiceAvailabilityOverrides,
  type PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult,
} from "../../../src/service-management/application/prune-expired-registered-service-availability-overrides.js";
import {
  RunServiceAvailabilityReconciliationSchedulerCycle,
  ServiceAvailabilityReconciliationSchedulerCycleError,
} from "../../../src/service-management/application/run-service-availability-reconciliation-scheduler-cycle.js";
import {
  RunServiceAvailabilityReconciliationTick,
  type ServiceAvailabilityReconciliationTickServiceResult,
} from "../../../src/service-management/application/run-service-availability-reconciliation-tick.js";
import { RegisteredServiceControlResult } from "../../../src/service-management/domain/registered-service-control-result.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import { InMemoryServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-reconciliation-scheduler-cursor-store.js";

const defaultOccurrenceClaimPruningResult = Object.freeze({
  kind: "no_cursor",
} as const);

function createCursor(
  completedThrough: string,
): ServiceAvailabilityReconciliationSchedulerCursor {
  return ServiceAvailabilityReconciliationSchedulerCursor.create({
    completedThrough,
  });
}

function createRunTick(): RunServiceAvailabilityReconciliationTick {
  const catalog: RegisteredServiceCatalog = {
    list: vi.fn(),
    findById: vi.fn(),
  };
  const planner = new PlanRegisteredServiceAvailabilityReconciliation(
    catalog,
    {
      findByServiceId: vi.fn(),
      save: vi.fn(),
      removeByServiceId: vi.fn(),
      removeByServiceIdIfMatches: vi.fn(),
    },
    { read: vi.fn() },
    { now: vi.fn() },
  );
  const control = new ControlRegisteredService(
    catalog,
    { execute: vi.fn() },
    { now: vi.fn() },
  );

  return new RunServiceAvailabilityReconciliationTick(
    new ListRegisteredServices(catalog),
    new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(catalog),
    new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
      planner,
      { claim: vi.fn(), pruneCompletedThrough: vi.fn() },
      control,
    ),
  );
}

function createStore(
  cursor: ServiceAvailabilityReconciliationSchedulerCursor | null,
): ServiceAvailabilityReconciliationSchedulerCursorStore & {
  readonly read: ReturnType<
    typeof vi.fn<ServiceAvailabilityReconciliationSchedulerCursorStore["read"]>
  >;
  readonly advance: ReturnType<
    typeof vi.fn<
      ServiceAvailabilityReconciliationSchedulerCursorStore["advance"]
    >
  >;
} {
  return {
    read: vi
      .fn<ServiceAvailabilityReconciliationSchedulerCursorStore["read"]>()
      .mockResolvedValue(cursor),
    advance: vi
      .fn<ServiceAvailabilityReconciliationSchedulerCursorStore["advance"]>()
      .mockImplementation((_expected, next) =>
        Promise.resolve(Object.freeze({ kind: "advanced", cursor: next })),
      ),
  };
}

function createPruner(): PruneExpiredRegisteredServiceAvailabilityOverrides {
  const catalog: RegisteredServiceCatalog = {
    list: vi.fn(),
    findById: vi.fn(),
  };

  return new PruneExpiredRegisteredServiceAvailabilityOverrides(
    new ListRegisteredServices(catalog),
    {
      findByServiceId: vi.fn(),
      save: vi.fn(),
      removeByServiceId: vi.fn(),
      removeByServiceIdIfMatches: vi.fn(),
    },
    { now: vi.fn() },
  );
}

function createOccurrenceClaimPruner(
  cursorStore: ServiceAvailabilityReconciliationSchedulerCursorStore,
): PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims {
  const occurrenceClaimStore: ServiceAvailabilityReconciliationOccurrenceClaimStore =
    {
      claim: vi.fn(),
      pruneCompletedThrough: vi.fn(),
    };

  return new PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims(
    cursorStore,
    occurrenceClaimStore,
  );
}

function createCycle(
  clockValue: unknown,
  currentCursor: ServiceAvailabilityReconciliationSchedulerCursor | null = null,
) {
  const clock = {
    now: vi.fn<Clock["now"]>().mockReturnValue(clockValue as Date),
  };
  const store = createStore(currentCursor);
  const tick = createRunTick();
  const tickExecute = vi
    .spyOn(tick, "execute")
    .mockResolvedValue(Object.freeze([]));
  const pruner = createPruner();
  const pruneExecute = vi
    .spyOn(pruner, "execute")
    .mockResolvedValue(Object.freeze([]));
  const occurrenceClaimPruner = createOccurrenceClaimPruner(store);
  const occurrenceClaimPruneExecute = vi
    .spyOn(occurrenceClaimPruner, "execute")
    .mockResolvedValue(defaultOccurrenceClaimPruningResult);

  return {
    cycle: new RunServiceAvailabilityReconciliationSchedulerCycle(
      clock,
      store,
      tick,
      pruner,
      occurrenceClaimPruner,
    ),
    clock,
    store,
    tickExecute,
    pruneExecute,
    occurrenceClaimPruneExecute,
  };
}

function createCompletedOccurrenceReport(
  resultKind: "none" | "duplicate" | "executed",
): readonly ServiceAvailabilityReconciliationTickServiceResult[] {
  const occurrence = ServiceAvailabilityReconciliationOccurrence.create({
    serviceId: "atlas-api",
    operation: "start",
    scheduledFor: "2026-07-26T12:30:00.000Z",
  });
  const result =
    resultKind === "executed"
      ? Object.freeze({
          kind: "executed" as const,
          controlResult: RegisteredServiceControlResult.create({
            serviceId: "atlas-api",
            operation: "start",
            completedAt: "2026-07-26T12:30:01.000Z",
          }),
        })
      : Object.freeze({ kind: resultKind });

  return Object.freeze([
    Object.freeze({
      kind: "completed",
      serviceId: "atlas-api",
      occurrenceResults: Object.freeze([
        Object.freeze({
          kind: "completed",
          occurrence,
          result,
        }),
      ]),
    }),
  ]);
}

function createPruningReport(
  kind: Exclude<
    PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult["kind"],
    "failed"
  >,
): readonly PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[] {
  return Object.freeze([
    Object.freeze({
      kind,
      serviceId: "atlas-api",
    }),
  ]);
}

describe("RunServiceAvailabilityReconciliationSchedulerCycle", () => {
  it("bootstraps an empty cursor with exactly one floored UTC minute", async () => {
    const clockDate = new Date("2026-07-26T12:30:47.123Z");
    const originalTimestamp = clockDate.getTime();
    const { cycle, clock, store, tickExecute, pruneExecute } =
      createCycle(clockDate);

    const result = await cycle.execute();

    expect(store.read).toHaveBeenCalledTimes(1);
    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(tickExecute).toHaveBeenCalledTimes(1);
    expect(pruneExecute).toHaveBeenCalledTimes(1);
    const [fromExclusive, toInclusive] = tickExecute.mock.calls[0] ?? [];
    expect(fromExclusive?.toISOString()).toBe("2026-07-26T12:29:00.000Z");
    expect(toInclusive?.toISOString()).toBe("2026-07-26T12:30:00.000Z");
    expect(store.advance).toHaveBeenCalledTimes(1);
    expect(store.advance.mock.calls[0]?.[0]).toBeNull();
    expect(store.advance.mock.calls[0]?.[1].completedThrough).toBe(
      "2026-07-26T12:30:00.000Z",
    );
    expect(result.kind).toBe("advanced");
    expect(clockDate.getTime()).toBe(originalTimestamp);
    expect(Object.isFrozen(clockDate)).toBe(false);
  });

  it("uses the current cursor as the exact lower boundary", async () => {
    const cursor = createCursor("2026-07-26T12:20:00.000Z");
    const { cycle, store, tickExecute } = createCycle(
      new Date("2026-07-26T12:30:59.999Z"),
      cursor,
    );

    await cycle.execute();

    const [fromExclusive, toInclusive] = tickExecute.mock.calls[0] ?? [];
    expect(fromExclusive?.toISOString()).toBe(cursor.completedThrough);
    expect(toInclusive?.toISOString()).toBe("2026-07-26T12:30:00.000Z");
    expect(store.advance.mock.calls[0]?.[0]).toBe(cursor);
    expect(Object.isFrozen(fromExclusive)).toBe(false);
    expect(Object.isFrozen(toInclusive)).toBe(false);
  });

  it.each([
    [
      "shorter than eight days",
      "2026-07-26T12:20:00.000Z",
      "2026-07-26T12:30:00.000Z",
    ],
    [
      "exactly eight days",
      "2026-07-18T12:30:00.000Z",
      "2026-07-26T12:30:00.000Z",
    ],
    [
      "longer than eight days",
      "2026-07-01T00:00:00.000Z",
      "2026-07-09T00:00:00.000Z",
    ],
  ])(
    "caps an interval %s at the expected upper boundary",
    async (_description, cursorTimestamp, expectedUpperBoundary) => {
      const { cycle, store, tickExecute } = createCycle(
        new Date("2026-07-26T12:30:00.000Z"),
        createCursor(cursorTimestamp),
      );

      await cycle.execute();

      expect(tickExecute).toHaveBeenCalledTimes(1);
      expect(tickExecute.mock.calls[0]?.[1].toISOString()).toBe(
        expectedUpperBoundary,
      );
      expect(store.advance.mock.calls[0]?.[1].completedThrough).toBe(
        expectedUpperBoundary,
      );
    },
  );

  it("returns frozen idle without ticking or advancing", async () => {
    const cursor = createCursor("2026-07-26T12:30:00.000Z");
    const {
      cycle,
      store,
      tickExecute,
      pruneExecute,
      occurrenceClaimPruneExecute,
    } = createCycle(new Date("2026-07-26T12:30:59.999Z"), cursor);

    const result = await cycle.execute();

    expect(result).toEqual({ kind: "idle", cursor });
    expect(result.cursor).toBe(cursor);
    expect(Object.isFrozen(result)).toBe(true);
    expect(tickExecute).not.toHaveBeenCalled();
    expect(pruneExecute).not.toHaveBeenCalled();
    expect(occurrenceClaimPruneExecute).not.toHaveBeenCalled();
    expect(store.advance).not.toHaveBeenCalled();
  });

  it("rejects safely when the clock target is before the cursor", async () => {
    const cursor = createCursor("2026-07-26T12:31:00.000Z");
    const { cycle, store, tickExecute, pruneExecute } = createCycle(
      new Date("2026-07-26T12:30:59.999Z"),
      cursor,
    );

    await expect(cycle.execute()).rejects.toMatchObject({
      name: "ServiceAvailabilityReconciliationSchedulerCycleError",
      code: "clock_before_cursor",
      message:
        "Service availability reconciliation scheduler cycle failed: clock_before_cursor",
    });
    expect(tickExecute).not.toHaveBeenCalled();
    expect(pruneExecute).not.toHaveBeenCalled();
    expect(store.advance).not.toHaveBeenCalled();
  });

  it.each([new Date("invalid"), "2026-07-26T12:30:00.000Z", null, 0])(
    "rejects the invalid clock output %# after reading the cursor",
    async (clockValue) => {
      const { cycle, clock, store, tickExecute, pruneExecute } =
        createCycle(clockValue);

      await expect(cycle.execute()).rejects.toMatchObject({
        name: "ServiceAvailabilityReconciliationSchedulerCycleError",
        code: "invalid_clock_time",
      });
      expect(store.read).toHaveBeenCalledTimes(1);
      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(tickExecute).not.toHaveBeenCalled();
      expect(pruneExecute).not.toHaveBeenCalled();
      expect(store.advance).not.toHaveBeenCalled();
    },
  );

  it.each(["none", "duplicate", "executed"] as const)(
    "treats %s occurrence processing as complete",
    async (resultKind) => {
      const { cycle, store, tickExecute, pruneExecute } = createCycle(
        new Date("2026-07-26T12:30:00.000Z"),
      );
      const report = createCompletedOccurrenceReport(resultKind);
      const pruningReport = Object.freeze([
        Object.freeze({
          kind: "not_removed" as const,
          serviceId: "atlas-api",
        }),
      ]);
      tickExecute.mockResolvedValue(report);
      pruneExecute.mockResolvedValue(pruningReport);

      const result = await cycle.execute();

      expect(result.kind).toBe("advanced");
      expect(result.kind === "advanced" && result.report).toBe(report);
      expect(result.kind === "advanced" && result.pruningReport).toBe(
        pruningReport,
      );
      expect(store.advance).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["no_override", "active", "removed", "not_removed"] as const)(
    "treats pruning result %s as complete",
    async (kind) => {
      const { cycle, store, pruneExecute } = createCycle(
        new Date("2026-07-26T12:30:00.000Z"),
      );
      const pruningReport = createPruningReport(kind);
      pruneExecute.mockResolvedValue(pruningReport);

      const result = await cycle.execute();

      expect(result.kind).toBe("advanced");
      expect(result.kind === "advanced" && result.pruningReport).toBe(
        pruningReport,
      );
      expect(store.advance).toHaveBeenCalledOnce();
    },
  );

  it.each(["no_cursor", "pruned", "unchanged"] as const)(
    "treats completed occurrence claim pruning result %s as complete",
    async (kind) => {
      const { cycle, store, occurrenceClaimPruneExecute } = createCycle(
        new Date("2026-07-26T12:30:00.000Z"),
      );
      const occurrenceClaimPruningResult = Object.freeze({ kind });
      occurrenceClaimPruneExecute.mockResolvedValue(
        occurrenceClaimPruningResult,
      );

      const result = await cycle.execute();

      expect(result.kind).toBe("advanced");
      expect(
        result.kind === "advanced" && result.occurrenceClaimPruningResult,
      ).toBe(occurrenceClaimPruningResult);
      expect(occurrenceClaimPruneExecute).toHaveBeenCalledOnce();
      expect(occurrenceClaimPruneExecute).toHaveBeenCalledWith();
      expect(store.advance).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      report: Object.freeze([
        Object.freeze({
          kind: "failed" as const,
          serviceId: "atlas-api",
          error: new Error("service failure"),
        }),
      ]),
    },
    {
      report: Object.freeze([
        Object.freeze({
          kind: "completed" as const,
          serviceId: "atlas-api",
          occurrenceResults: Object.freeze([
            Object.freeze({
              kind: "failed" as const,
              occurrence: ServiceAvailabilityReconciliationOccurrence.create({
                serviceId: "atlas-api",
                operation: "start",
                scheduledFor: "2026-07-26T12:30:00.000Z",
              }),
              error: new Error("occurrence failure"),
            }),
          ]),
        }),
      ]),
    },
  ])(
    "returns incomplete without advancing for failed work",
    async ({ report }) => {
      const cursor = createCursor("2026-07-26T12:29:00.000Z");
      const { cycle, store, tickExecute, pruneExecute } = createCycle(
        new Date("2026-07-26T12:30:00.000Z"),
        cursor,
      );
      tickExecute.mockResolvedValue(report);
      const pruningReport = Object.freeze([]);
      pruneExecute.mockResolvedValue(pruningReport);

      const result = await cycle.execute();

      expect(result).toEqual({
        kind: "incomplete",
        cursor,
        report,
        pruningReport,
        occurrenceClaimPruningResult: defaultOccurrenceClaimPruningResult,
      });
      expect(result.kind === "incomplete" && result.cursor).toBe(cursor);
      expect(result.kind === "incomplete" && result.report).toBe(report);
      expect(result.kind === "incomplete" && result.pruningReport).toBe(
        pruningReport,
      );
      expect(
        result.kind === "incomplete" && result.occurrenceClaimPruningResult,
      ).toBe(defaultOccurrenceClaimPruningResult);
      expect(Object.isFrozen(result)).toBe(true);
      expect(store.advance).not.toHaveBeenCalled();
    },
  );

  it("returns incomplete without advancing when pruning reports a service failure", async () => {
    const cursor = createCursor("2026-07-26T12:29:00.000Z");
    const failure = new Error("pruning service failure");
    const {
      cycle,
      store,
      tickExecute,
      pruneExecute,
      occurrenceClaimPruneExecute,
    } = createCycle(new Date("2026-07-26T12:30:00.000Z"), cursor);
    const report = Object.freeze([]);
    const pruningReport = Object.freeze([
      Object.freeze({
        kind: "failed" as const,
        serviceId: "atlas-api",
        error: failure,
      }),
    ]);
    tickExecute.mockResolvedValue(report);
    pruneExecute.mockResolvedValue(pruningReport);

    const result = await cycle.execute();

    expect(result).toEqual({
      kind: "incomplete",
      cursor,
      report,
      pruningReport,
      occurrenceClaimPruningResult: null,
    });
    expect(result.kind === "incomplete" && result.report).toBe(report);
    expect(result.kind === "incomplete" && result.pruningReport).toBe(
      pruningReport,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(pruningReport)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(false);
    expect(store.advance).not.toHaveBeenCalled();
    expect(pruneExecute).toHaveBeenCalledOnce();
    expect(occurrenceClaimPruneExecute).not.toHaveBeenCalled();
  });

  it("returns one incomplete result when both reports contain failures", async () => {
    const reconciliationFailure = new Error("reconciliation failure");
    const pruningFailure = new Error("pruning failure");
    const {
      cycle,
      store,
      tickExecute,
      pruneExecute,
      occurrenceClaimPruneExecute,
    } = createCycle(new Date("2026-07-26T12:30:00.000Z"));
    const report = Object.freeze([
      Object.freeze({
        kind: "failed" as const,
        serviceId: "atlas-api",
        error: reconciliationFailure,
      }),
    ]);
    const pruningReport = Object.freeze([
      Object.freeze({
        kind: "failed" as const,
        serviceId: "atlas-api",
        error: pruningFailure,
      }),
    ]);
    tickExecute.mockResolvedValue(report);
    pruneExecute.mockResolvedValue(pruningReport);

    const result = await cycle.execute();

    expect(result).toEqual({
      kind: "incomplete",
      cursor: null,
      report,
      pruningReport,
      occurrenceClaimPruningResult: null,
    });
    expect(store.advance).not.toHaveBeenCalled();
    expect(pruneExecute).toHaveBeenCalledOnce();
    expect(occurrenceClaimPruneExecute).not.toHaveBeenCalled();
  });

  it("propagates tick rejection without advancing", async () => {
    const {
      cycle,
      store,
      tickExecute,
      pruneExecute,
      occurrenceClaimPruneExecute,
    } = createCycle(new Date("2026-07-26T12:30:00.000Z"));
    const sentinel = new Error("tick sentinel");
    tickExecute.mockRejectedValue(sentinel);

    await expect(cycle.execute()).rejects.toBe(sentinel);
    expect(tickExecute).toHaveBeenCalledTimes(1);
    expect(pruneExecute).not.toHaveBeenCalled();
    expect(occurrenceClaimPruneExecute).not.toHaveBeenCalled();
    expect(store.advance).not.toHaveBeenCalled();
  });

  it("propagates pruning rejection after one completed tick without advancing", async () => {
    const {
      cycle,
      store,
      tickExecute,
      pruneExecute,
      occurrenceClaimPruneExecute,
    } = createCycle(new Date("2026-07-26T12:30:00.000Z"));
    const sentinel = new Error("pruning sentinel");
    pruneExecute.mockRejectedValue(sentinel);

    await expect(cycle.execute()).rejects.toBe(sentinel);
    expect(tickExecute).toHaveBeenCalledOnce();
    expect(pruneExecute).toHaveBeenCalledOnce();
    expect(occurrenceClaimPruneExecute).not.toHaveBeenCalled();
    expect(store.advance).not.toHaveBeenCalled();
  });

  it("propagates completed claim pruning rejection without advancing or retrying", async () => {
    const {
      cycle,
      store,
      tickExecute,
      pruneExecute,
      occurrenceClaimPruneExecute,
    } = createCycle(new Date("2026-07-26T12:30:00.000Z"));
    const sentinel = new Error("completed claim pruning sentinel");
    occurrenceClaimPruneExecute.mockRejectedValue(sentinel);

    await expect(cycle.execute()).rejects.toBe(sentinel);
    expect(tickExecute).toHaveBeenCalledOnce();
    expect(pruneExecute).toHaveBeenCalledOnce();
    expect(occurrenceClaimPruneExecute).toHaveBeenCalledOnce();
    expect(store.advance).not.toHaveBeenCalled();
  });

  it("waits for the tick, then pruning, before cursor advancement", async () => {
    const {
      cycle,
      store,
      tickExecute,
      pruneExecute,
      occurrenceClaimPruneExecute,
    } = createCycle(new Date("2026-07-26T12:30:00.000Z"));
    let resolveTick!: (
      value: readonly ServiceAvailabilityReconciliationTickServiceResult[],
    ) => void;
    let resolvePruning!: (
      value: readonly PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[],
    ) => void;
    let resolveOccurrenceClaimPruning!: (
      value: PruneCompletedServiceAvailabilityReconciliationOccurrenceClaimsResult,
    ) => void;
    const tickCompletion = new Promise<
      readonly ServiceAvailabilityReconciliationTickServiceResult[]
    >((resolve) => {
      resolveTick = resolve;
    });
    const pruningCompletion = new Promise<
      readonly PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[]
    >((resolve) => {
      resolvePruning = resolve;
    });
    const occurrenceClaimPruningCompletion =
      new Promise<PruneCompletedServiceAvailabilityReconciliationOccurrenceClaimsResult>(
        (resolve) => {
          resolveOccurrenceClaimPruning = resolve;
        },
      );
    tickExecute.mockReturnValue(tickCompletion);
    pruneExecute.mockReturnValue(pruningCompletion);
    occurrenceClaimPruneExecute.mockReturnValue(
      occurrenceClaimPruningCompletion,
    );

    const execution = cycle.execute();

    await vi.waitFor(() => expect(tickExecute).toHaveBeenCalledOnce());
    expect(pruneExecute).not.toHaveBeenCalled();
    expect(occurrenceClaimPruneExecute).not.toHaveBeenCalled();
    expect(store.advance).not.toHaveBeenCalled();

    resolveTick(Object.freeze([]));
    await vi.waitFor(() => expect(pruneExecute).toHaveBeenCalledOnce());
    expect(occurrenceClaimPruneExecute).not.toHaveBeenCalled();
    expect(store.advance).not.toHaveBeenCalled();

    resolvePruning(Object.freeze([]));
    await vi.waitFor(() =>
      expect(occurrenceClaimPruneExecute).toHaveBeenCalledOnce(),
    );
    expect(store.advance).not.toHaveBeenCalled();

    resolveOccurrenceClaimPruning(defaultOccurrenceClaimPruningResult);
    await expect(execution).resolves.toMatchObject({ kind: "advanced" });
    expect(store.advance).toHaveBeenCalledOnce();
  });

  it("preserves advanced cursor and report identity in a frozen result", async () => {
    const { cycle, store, tickExecute, pruneExecute } = createCycle(
      new Date("2026-07-26T12:30:00.000Z"),
    );
    const report: ServiceAvailabilityReconciliationTickServiceResult[] = [];
    const pruningReport: PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[] =
      [];
    const advancedCursor = createCursor("2026-07-26T12:30:00.000Z");
    tickExecute.mockResolvedValue(report);
    pruneExecute.mockResolvedValue(pruningReport);
    store.advance.mockResolvedValue(
      Object.freeze({ kind: "advanced", cursor: advancedCursor }),
    );

    const result = await cycle.execute();

    expect(result).toEqual({
      kind: "advanced",
      cursor: advancedCursor,
      report,
      pruningReport,
      occurrenceClaimPruningResult: defaultOccurrenceClaimPruningResult,
    });
    expect(result.kind === "advanced" && result.cursor).toBe(advancedCursor);
    expect(result.kind === "advanced" && result.report).toBe(report);
    expect(result.kind === "advanced" && result.pruningReport).toBe(
      pruningReport,
    );
    expect(
      result.kind === "advanced" && result.occurrenceClaimPruningResult,
    ).toBe(defaultOccurrenceClaimPruningResult);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(report)).toBe(false);
    expect(Object.isFrozen(pruningReport)).toBe(false);
    expect(Object.keys(result)).toEqual([
      "kind",
      "cursor",
      "report",
      "pruningReport",
      "occurrenceClaimPruningResult",
    ]);
  });

  it.each([createCursor("2026-07-26T12:31:00.000Z"), null])(
    "returns conflict cursor %# without retrying",
    async (conflictCursor) => {
      const { cycle, store, tickExecute, pruneExecute } = createCycle(
        new Date("2026-07-26T12:30:00.000Z"),
      );
      const report = Object.freeze([]);
      const pruningReport = Object.freeze([]);
      tickExecute.mockResolvedValue(report);
      pruneExecute.mockResolvedValue(pruningReport);
      store.advance.mockResolvedValue(
        Object.freeze({ kind: "conflict", cursor: conflictCursor }),
      );

      const result = await cycle.execute();

      expect(result).toEqual({
        kind: "conflict",
        cursor: conflictCursor,
        report,
        pruningReport,
        occurrenceClaimPruningResult: defaultOccurrenceClaimPruningResult,
      });
      expect(result.kind === "conflict" && result.cursor).toBe(conflictCursor);
      expect(result.kind === "conflict" && result.report).toBe(report);
      expect(result.kind === "conflict" && result.pruningReport).toBe(
        pruningReport,
      );
      expect(
        result.kind === "conflict" && result.occurrenceClaimPruningResult,
      ).toBe(defaultOccurrenceClaimPruningResult);
      expect(Object.isFrozen(result)).toBe(true);
      expect(store.read).toHaveBeenCalledTimes(1);
      expect(store.advance).toHaveBeenCalledTimes(1);
      expect(tickExecute).toHaveBeenCalledTimes(1);
      expect(pruneExecute).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["read", "advance"] as const)(
    "propagates %s dependency failure unchanged",
    async (dependency) => {
      const { cycle, store, tickExecute, pruneExecute } = createCycle(
        new Date("2026-07-26T12:30:00.000Z"),
      );
      const sentinel = new Error(`${dependency} sentinel`);

      if (dependency === "read") {
        store.read.mockRejectedValue(sentinel);
      } else {
        store.advance.mockRejectedValue(sentinel);
      }

      await expect(cycle.execute()).rejects.toBe(sentinel);
      if (dependency === "read") {
        expect(tickExecute).not.toHaveBeenCalled();
        expect(pruneExecute).not.toHaveBeenCalled();
      } else {
        expect(tickExecute).toHaveBeenCalledTimes(1);
        expect(pruneExecute).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("allows one concurrent cycle to advance and returns conflicts for stale peers", async () => {
    const store =
      new InMemoryServiceAvailabilityReconciliationSchedulerCursorStore();
    const clock: Clock = {
      now: () => new Date("2026-07-26T12:30:00.000Z"),
    };
    const cycles = Array.from(
      { length: 10 },
      () =>
        new RunServiceAvailabilityReconciliationSchedulerCycle(
          clock,
          store,
          Object.assign(createRunTick(), {
            execute: vi.fn().mockResolvedValue(Object.freeze([])),
          }),
          Object.assign(createPruner(), {
            execute: vi.fn().mockResolvedValue(Object.freeze([])),
          }),
          Object.assign(createOccurrenceClaimPruner(store), {
            execute: vi
              .fn()
              .mockResolvedValue(defaultOccurrenceClaimPruningResult),
          }),
        ),
    );

    const results = await Promise.all(cycles.map((cycle) => cycle.execute()));

    expect(results.filter(({ kind }) => kind === "advanced")).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === "conflict")).toHaveLength(9);
  });

  it("does not use current time, timers, or process listeners", async () => {
    const { cycle } = createCycle(new Date("2026-07-26T12:30:00.000Z"));
    const dateNow = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOn = vi.spyOn(process, "on");

    await cycle.execute();

    expect(dateNow).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(processOn).not.toHaveBeenCalled();
  });

  it("uses safe cycle errors without timestamps or causes", () => {
    for (const code of ["invalid_clock_time", "clock_before_cursor"] as const) {
      const error = new ServiceAvailabilityReconciliationSchedulerCycleError(
        code,
      );

      expect(error).toEqual(
        expect.objectContaining({
          name: "ServiceAvailabilityReconciliationSchedulerCycleError",
          code,
          message: `Service availability reconciliation scheduler cycle failed: ${code}`,
        }),
      );
      expect(error).not.toHaveProperty("cause");
      expect(Object.keys(error)).toEqual(["code", "name"]);
    }
  });
});
