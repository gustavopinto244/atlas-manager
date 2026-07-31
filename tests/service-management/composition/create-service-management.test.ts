import { describe, expect, it, vi } from "vitest";

import { CancelRegisteredServiceAvailabilityOverride } from "../../../src/service-management/application/cancel-registered-service-availability-override.js";
import { ControlRegisteredService } from "../../../src/service-management/application/control-registered-service.js";
import { ExecuteRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/execute-registered-service-availability-reconciliation.js";
import { ExecuteRegisteredServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.js";
import { GenerateRegisteredServiceAvailabilityReconciliationOccurrences } from "../../../src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.js";
import { GetRegisteredServiceEffectiveAvailability } from "../../../src/service-management/application/get-registered-service-effective-availability.js";
import { GetRegisteredServiceLogs } from "../../../src/service-management/application/get-registered-service-logs.js";
import { GetRegisteredServiceStatus } from "../../../src/service-management/application/get-registered-service-status.js";
import { ListRegisteredServices } from "../../../src/service-management/application/list-registered-services.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/plan-registered-service-availability-reconciliation.js";
import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type { ServiceAvailabilityOverrideStore } from "../../../src/service-management/application/ports/service-availability-override-store.js";
import type { ServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import type { ServiceAvailabilityReconciliationSchedulerTimer } from "../../../src/service-management/application/ports/service-availability-reconciliation-scheduler-timer.js";
import { PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims } from "../../../src/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.js";
import { PruneExpiredRegisteredServiceAvailabilityOverrides } from "../../../src/service-management/application/prune-expired-registered-service-availability-overrides.js";
import { RunServiceAvailabilityReconciliationSchedulerCycle } from "../../../src/service-management/application/run-service-availability-reconciliation-scheduler-cycle.js";
import { RunServiceAvailabilityReconciliationTick } from "../../../src/service-management/application/run-service-availability-reconciliation-tick.js";
import { ServiceAvailabilityReconciliationSchedulerLoop } from "../../../src/service-management/application/service-availability-reconciliation-scheduler-loop.js";
import { SetRegisteredServiceAvailabilityOverride } from "../../../src/service-management/application/set-registered-service-availability-override.js";
import {
  createServiceManagement,
  type ServiceManagementCompositionOverrides,
} from "../../../src/service-management/composition/create-service-management.js";
import type { MockServiceStatusConfiguration } from "../../../src/service-management/infrastructure/mock-service-status-reader.js";
import {
  ServiceAvailabilityReconciliationOccurrence,
  type CreateServiceAvailabilityReconciliationOccurrenceInput,
} from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import type { Pm2ServiceControlExecutor } from "../../../src/service-management/infrastructure/pm2-service-control-executor.js";
import { InMemoryServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-reconciliation-scheduler-cursor-store.js";
import type { ServiceAvailabilityOverride } from "../../../src/service-scheduling/domain/service-availability-override.js";

const firstTimestamp = "2026-07-25T12:00:00.000Z";
const secondTimestamp = "2026-07-25T12:01:00.000Z";
const occurrenceTimestamp = "2026-07-25T12:00:00.000Z";

interface ConfiguredService {
  readonly id: string;
  readonly displayName: string;
  readonly managementAdapter: "mock" | "pm2";
  readonly externalResourceId: string;
  readonly supportedOperations: readonly string[];
  readonly availabilityPolicy: unknown;
}

function createConfiguredService(
  managementAdapter: "mock" | "pm2",
  overrides: Partial<ConfiguredService> = {},
): ConfiguredService {
  return {
    id: `${managementAdapter}-service`,
    displayName: `${managementAdapter.toUpperCase()} Service`,
    managementAdapter,
    externalResourceId: `${managementAdapter}-target`,
    supportedOperations: ["readStatus", "start", "stop", "restart"],
    availabilityPolicy: { mode: "manual" },
    ...overrides,
  };
}

function createEnvironment(
  services: readonly ConfiguredService[],
): Readonly<Record<string, string | undefined>> {
  return {
    REGISTERED_SERVICES_JSON: JSON.stringify(services),
  };
}

function createOccurrence(
  input: Partial<CreateServiceAvailabilityReconciliationOccurrenceInput> = {},
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId: "mock-service",
    operation: "start",
    scheduledFor: occurrenceTimestamp,
    ...input,
  });
}

function createClock(...timestamps: readonly string[]): Clock & {
  readonly now: ReturnType<typeof vi.fn<Clock["now"]>>;
} {
  const now = vi.fn<Clock["now"]>();

  if (timestamps.length === 0) {
    now.mockReturnValue(new Date());
    return { now };
  }

  for (const timestamp of timestamps) {
    now.mockReturnValueOnce(new Date(timestamp));
  }

  now.mockReturnValue(new Date(timestamps[timestamps.length - 1]!));
  return { now };
}

function createProcessListExecutor(output: string): Pm2ProcessListExecutor & {
  readonly execute: ReturnType<typeof vi.fn<Pm2ProcessListExecutor["execute"]>>;
} {
  return {
    execute: vi
      .fn<Pm2ProcessListExecutor["execute"]>()
      .mockResolvedValue(output),
  };
}

function createControlExecutor(): Pm2ServiceControlExecutor & {
  readonly execute: ReturnType<
    typeof vi.fn<Pm2ServiceControlExecutor["execute"]>
  >;
} {
  return {
    execute: vi.fn<Pm2ServiceControlExecutor["execute"]>().mockResolvedValue(),
  };
}

function createSchedulerTimer(): ServiceAvailabilityReconciliationSchedulerTimer & {
  readonly schedule: ReturnType<
    typeof vi.fn<ServiceAvailabilityReconciliationSchedulerTimer["schedule"]>
  >;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly callbacks: (() => void)[];
} {
  const callbacks: (() => void)[] = [];
  const cancel = vi.fn();
  const schedule = vi.fn<
    ServiceAvailabilityReconciliationSchedulerTimer["schedule"]
  >((_delayMilliseconds, callback) => {
    callbacks.push(callback);
    return Object.freeze({ cancel });
  });

  return { schedule, cancel, callbacks };
}

function createPm2Process(
  name = "pm2-target",
  processId = 42,
  status = "online",
): Record<string, unknown> {
  return {
    name,
    pm_id: processId,
    pm2_env: { status },
    pid: 8_421,
    environmentSecret: "private-environment-value",
  };
}

describe("createServiceManagement", () => {
  it("returns exactly the seventeen frozen application capabilities", () => {
    const capabilities = createServiceManagement({});

    expect(capabilities.listRegisteredServices).toBeInstanceOf(
      ListRegisteredServices,
    );
    expect(capabilities.getRegisteredServiceStatus).toBeInstanceOf(
      GetRegisteredServiceStatus,
    );
    expect(capabilities.controlRegisteredService).toBeInstanceOf(
      ControlRegisteredService,
    );
    expect(capabilities.getRegisteredServiceLogs).toBeInstanceOf(
      GetRegisteredServiceLogs,
    );
    expect(
      capabilities.setRegisteredServiceAvailabilityOverride,
    ).toBeInstanceOf(SetRegisteredServiceAvailabilityOverride);
    expect(
      capabilities.cancelRegisteredServiceAvailabilityOverride,
    ).toBeInstanceOf(CancelRegisteredServiceAvailabilityOverride);
    expect(
      capabilities.getRegisteredServiceEffectiveAvailability,
    ).toBeInstanceOf(GetRegisteredServiceEffectiveAvailability);
    expect(
      capabilities.pruneExpiredRegisteredServiceAvailabilityOverrides,
    ).toBeInstanceOf(PruneExpiredRegisteredServiceAvailabilityOverrides);
    expect(
      capabilities.pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
    ).toBeInstanceOf(
      PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
    );
    expect(
      capabilities.planRegisteredServiceAvailabilityReconciliation,
    ).toBeInstanceOf(PlanRegisteredServiceAvailabilityReconciliation);
    expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliation,
    ).toBeInstanceOf(ExecuteRegisteredServiceAvailabilityReconciliation);
    expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence,
    ).toBeInstanceOf(
      ExecuteRegisteredServiceAvailabilityReconciliationOccurrence,
    );
    expect(
      capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences,
    ).toBeInstanceOf(
      GenerateRegisteredServiceAvailabilityReconciliationOccurrences,
    );
    expect(
      capabilities.runServiceAvailabilityReconciliationTick,
    ).toBeInstanceOf(RunServiceAvailabilityReconciliationTick);
    expect(
      capabilities.runServiceAvailabilityReconciliationSchedulerCycle,
    ).toBeInstanceOf(RunServiceAvailabilityReconciliationSchedulerCycle);
    expect(
      capabilities.serviceAvailabilityReconciliationSchedulerLoop,
    ).toBeInstanceOf(ServiceAvailabilityReconciliationSchedulerLoop);
    expect(Object.keys(capabilities)).toEqual([
      "listRegisteredServices",
      "getRegisteredServiceStatus",
      "controlRegisteredService",
      "orchestrateRegisteredServiceControl",
      "getRegisteredServiceLogs",
      "setRegisteredServiceAvailabilityOverride",
      "cancelRegisteredServiceAvailabilityOverride",
      "getRegisteredServiceEffectiveAvailability",
      "getRegisteredServiceAvailabilityForInterval",
      "pruneExpiredRegisteredServiceAvailabilityOverrides",
      "pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims",
      "planRegisteredServiceAvailabilityReconciliation",
      "executeRegisteredServiceAvailabilityReconciliation",
      "executeRegisteredServiceAvailabilityReconciliationOccurrence",
      "generateRegisteredServiceAvailabilityReconciliationOccurrences",
      "runServiceAvailabilityReconciliationTick",
      "runServiceAvailabilityReconciliationSchedulerCycle",
      "serviceAvailabilityReconciliationSchedulerLoop",
    ]);
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities).not.toHaveProperty("catalog");
    expect(capabilities).not.toHaveProperty("statusReader");
    expect(capabilities).not.toHaveProperty("controller");
    expect(capabilities).not.toHaveProperty("serviceAvailabilityOverrideStore");
    expect(capabilities).not.toHaveProperty("overrideStore");
    expect(capabilities).not.toHaveProperty("clock");
    expect(capabilities).not.toHaveProperty("scheduler");
    expect(capabilities).not.toHaveProperty("executionStore");
    expect(capabilities).not.toHaveProperty(
      "serviceAvailabilityReconciliationOccurrenceClaimStore",
    );
    expect(capabilities).not.toHaveProperty("occurrenceClaimStore");
    expect(capabilities).not.toHaveProperty("processListExecutor");
    expect(capabilities).not.toHaveProperty("overrides");
    expect(capabilities).not.toHaveProperty("environment");
    expect(capabilities).not.toHaveProperty("registeredServiceCatalog");
    expect(capabilities).not.toHaveProperty("schedulerClock");
    expect(capabilities).not.toHaveProperty("cursor");
    expect(capabilities).not.toHaveProperty(
      "serviceAvailabilityReconciliationSchedulerCursorStore",
    );
    expect(capabilities).not.toHaveProperty("schedulerCursorStore");
    expect(capabilities).not.toHaveProperty(
      "serviceAvailabilityReconciliationSchedulerTimer",
    );
    expect(capabilities).not.toHaveProperty("schedulerTimer");
  });

  it("keeps application capability references stable per composition", () => {
    const capabilities = createServiceManagement({});
    const otherCapabilities = createServiceManagement({});

    expect(capabilities.setRegisteredServiceAvailabilityOverride).toBe(
      capabilities.setRegisteredServiceAvailabilityOverride,
    );
    expect(capabilities.cancelRegisteredServiceAvailabilityOverride).toBe(
      capabilities.cancelRegisteredServiceAvailabilityOverride,
    );
    expect(capabilities.getRegisteredServiceEffectiveAvailability).toBe(
      capabilities.getRegisteredServiceEffectiveAvailability,
    );
    expect(
      capabilities.pruneExpiredRegisteredServiceAvailabilityOverrides,
    ).toBe(capabilities.pruneExpiredRegisteredServiceAvailabilityOverrides);
    expect(
      capabilities.pruneExpiredRegisteredServiceAvailabilityOverrides,
    ).not.toBe(
      otherCapabilities.pruneExpiredRegisteredServiceAvailabilityOverrides,
    );
    expect(
      capabilities.pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
    ).toBe(
      capabilities.pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
    );
    expect(
      capabilities.pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
    ).not.toBe(
      otherCapabilities.pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
    );
    expect(capabilities.planRegisteredServiceAvailabilityReconciliation).toBe(
      capabilities.planRegisteredServiceAvailabilityReconciliation,
    );
    expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliation,
    ).toBe(capabilities.executeRegisteredServiceAvailabilityReconciliation);
    expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliation,
    ).not.toBe(
      otherCapabilities.executeRegisteredServiceAvailabilityReconciliation,
    );
    expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence,
    ).toBe(
      capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence,
    );
    expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence,
    ).not.toBe(
      otherCapabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence,
    );
    expect(
      capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences,
    ).toBe(
      capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences,
    );
    expect(
      capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences,
    ).not.toBe(
      otherCapabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences,
    );
    expect(capabilities.runServiceAvailabilityReconciliationTick).toBe(
      capabilities.runServiceAvailabilityReconciliationTick,
    );
    expect(capabilities.runServiceAvailabilityReconciliationTick).not.toBe(
      otherCapabilities.runServiceAvailabilityReconciliationTick,
    );
    expect(
      capabilities.runServiceAvailabilityReconciliationSchedulerCycle,
    ).toBe(capabilities.runServiceAvailabilityReconciliationSchedulerCycle);
    expect(
      capabilities.runServiceAvailabilityReconciliationSchedulerCycle,
    ).not.toBe(
      otherCapabilities.runServiceAvailabilityReconciliationSchedulerCycle,
    );
    expect(capabilities.serviceAvailabilityReconciliationSchedulerLoop).toBe(
      capabilities.serviceAvailabilityReconciliationSchedulerLoop,
    );
    expect(
      capabilities.serviceAvailabilityReconciliationSchedulerLoop,
    ).not.toBe(
      otherCapabilities.serviceAvailabilityReconciliationSchedulerLoop,
    );
  });

  it("reuses the exact scheduler cycle and timer override without construction work", async () => {
    const timer = createSchedulerTimer();
    const clock = createClock("2026-07-26T12:30:00.000Z");
    const capabilities = createServiceManagement(
      {},
      {
        clock,
        serviceAvailabilityReconciliationSchedulerTimer: timer,
      },
    );
    const cycleResult = Object.freeze({
      kind: "advanced" as const,
      cursor: Object.freeze({
        completedThrough: "2026-07-26T12:30:00.000Z",
      }),
      report: Object.freeze([]),
      pruningReport: Object.freeze([]),
      occurrenceClaimPruningResult: Object.freeze({ kind: "unchanged" }),
    });
    const cycle = vi
      .spyOn(
        capabilities.runServiceAvailabilityReconciliationSchedulerCycle,
        "execute",
      )
      .mockResolvedValue(cycleResult);

    expect(timer.schedule).not.toHaveBeenCalled();
    expect(timer.cancel).not.toHaveBeenCalled();
    expect(cycle).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();

    const firstCompletion =
      capabilities.serviceAvailabilityReconciliationSchedulerLoop.start();
    const secondCompletion =
      capabilities.serviceAvailabilityReconciliationSchedulerLoop.start();

    expect(secondCompletion).toBe(firstCompletion);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(timer.schedule).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(timer.schedule).toHaveBeenCalledExactlyOnceWith(
        60_000,
        expect.any(Function),
      );
    });

    const stopCompletion =
      capabilities.serviceAvailabilityReconciliationSchedulerLoop.stop();

    expect(stopCompletion).toBe(firstCompletion);
    await expect(stopCompletion).resolves.toEqual({ kind: "stopped" });
    expect(timer.cancel).toHaveBeenCalledOnce();
  });

  it("keeps shared timer overrides from merging loop lifecycle state", async () => {
    const timer = createSchedulerTimer();
    const first = createServiceManagement(
      {},
      {
        clock: createClock("2026-07-26T12:30:00.000Z"),
        serviceAvailabilityReconciliationSchedulerTimer: timer,
      },
    );
    const second = createServiceManagement(
      {},
      {
        clock: createClock("2026-07-26T12:30:00.000Z"),
        serviceAvailabilityReconciliationSchedulerTimer: timer,
      },
    );
    const firstCycle = vi
      .spyOn(
        first.runServiceAvailabilityReconciliationSchedulerCycle,
        "execute",
      )
      .mockResolvedValue(
        Object.freeze({
          kind: "conflict",
          cursor: null,
          report: Object.freeze([]),
          pruningReport: Object.freeze([]),
          occurrenceClaimPruningResult: Object.freeze({ kind: "unchanged" }),
        }),
      );
    const secondCycle = vi.spyOn(
      second.runServiceAvailabilityReconciliationSchedulerCycle,
      "execute",
    );

    const completion =
      first.serviceAvailabilityReconciliationSchedulerLoop.start();

    await expect(completion).resolves.toMatchObject({ kind: "conflict" });
    expect(firstCycle).toHaveBeenCalledOnce();
    expect(secondCycle).not.toHaveBeenCalled();
    expect(timer.schedule).not.toHaveBeenCalled();

    const secondCompletion =
      second.serviceAvailabilityReconciliationSchedulerLoop.stop();
    await expect(secondCompletion).resolves.toEqual({ kind: "stopped" });
    expect(first.serviceAvailabilityReconciliationSchedulerLoop).not.toBe(
      second.serviceAvailabilityReconciliationSchedulerLoop,
    );
  });

  it("keeps direct cycle and tick calls independent from the scheduler loop", async () => {
    const timer = createSchedulerTimer();
    const capabilities = createServiceManagement(
      {},
      {
        clock: createClock(
          "2026-07-26T12:30:00.000Z",
          "2026-07-26T12:30:00.000Z",
        ),
        serviceAvailabilityReconciliationSchedulerTimer: timer,
      },
    );

    await capabilities.runServiceAvailabilityReconciliationTick.execute(
      new Date("2026-07-26T12:29:00.000Z"),
      new Date("2026-07-26T12:30:00.000Z"),
    );
    await capabilities.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(timer.schedule).not.toHaveBeenCalled();
    expect(timer.cancel).not.toHaveBeenCalled();

    const completion =
      capabilities.serviceAvailabilityReconciliationSchedulerLoop.stop();
    await expect(completion).resolves.toEqual({ kind: "stopped" });
    expect(timer.schedule).not.toHaveBeenCalled();
  });

  it("reuses the exact shared clock and tick in the scheduler cycle", async () => {
    const clock = createClock("2026-07-26T12:30:47.123Z");
    const capabilities = createServiceManagement({}, { clock });
    const tick = vi
      .spyOn(capabilities.runServiceAvailabilityReconciliationTick, "execute")
      .mockResolvedValue(Object.freeze([]));
    const prune = vi
      .spyOn(
        capabilities.pruneExpiredRegisteredServiceAvailabilityOverrides,
        "execute",
      )
      .mockResolvedValue(Object.freeze([]));
    const pruneClaims = vi
      .spyOn(
        capabilities.pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
        "execute",
      )
      .mockResolvedValue(Object.freeze({ kind: "no_cursor" }));

    expect(clock.now).not.toHaveBeenCalled();
    expect(tick).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
    expect(pruneClaims).not.toHaveBeenCalled();

    const result =
      await capabilities.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(pruneClaims).toHaveBeenCalledTimes(1);
    expect(tick.mock.calls[0]?.[0].toISOString()).toBe(
      "2026-07-26T12:29:00.000Z",
    );
    expect(tick.mock.calls[0]?.[1].toISOString()).toBe(
      "2026-07-26T12:30:00.000Z",
    );
    expect(result.kind).toBe("advanced");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("preserves default cursor continuity across repeated cycle calls", async () => {
    const clock = createClock(
      "2026-07-26T12:30:47.123Z",
      "2026-07-26T12:30:47.123Z",
      "2026-07-26T12:30:59.999Z",
      "2026-07-26T12:31:12.000Z",
      "2026-07-26T12:31:12.000Z",
    );
    const capabilities = createServiceManagement({}, { clock });

    const first =
      await capabilities.runServiceAvailabilityReconciliationSchedulerCycle.execute();
    const second =
      await capabilities.runServiceAvailabilityReconciliationSchedulerCycle.execute();
    const third =
      await capabilities.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(first.kind).toBe("advanced");
    expect(second.kind).toBe("idle");
    expect(third.kind).toBe("advanced");
    expect(
      first.kind === "advanced" && first.occurrenceClaimPruningResult,
    ).toEqual({ kind: "no_cursor" });
    expect(
      third.kind === "advanced" && third.occurrenceClaimPruningResult,
    ).toEqual({ kind: "unchanged" });
    expect(
      first.kind === "advanced" &&
        second.kind === "idle" &&
        second.cursor.completedThrough === first.cursor.completedThrough,
    ).toBe(true);
    expect(
      third.kind === "advanced" &&
        third.cursor.completedThrough === "2026-07-26T12:31:00.000Z",
    ).toBe(true);
  });

  it("uses the exact cursor-store override without construction side effects", async () => {
    const read = vi
      .fn<ServiceAvailabilityReconciliationSchedulerCursorStore["read"]>()
      .mockResolvedValue(null);
    const advance = vi
      .fn<ServiceAvailabilityReconciliationSchedulerCursorStore["advance"]>()
      .mockImplementation((_expected, next) =>
        Promise.resolve(Object.freeze({ kind: "advanced", cursor: next })),
      );
    const cursorStore = { read, advance };
    const clock = createClock(
      "2026-07-26T12:30:00.000Z",
      "2026-07-26T12:30:00.000Z",
    );
    const capabilities = createServiceManagement(
      {},
      {
        clock,
        serviceAvailabilityReconciliationSchedulerCursorStore: cursorStore,
      },
    );

    expect(read).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();

    const result =
      await capabilities.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(read).toHaveBeenCalledTimes(2);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance.mock.calls[0]?.[0]).toBeNull();
    const candidateCursor = advance.mock.calls[0]?.[1];
    expect(result.kind === "advanced" && result.cursor).toBe(candidateCursor);
  });

  it("shares exact cursor and occurrence claim stores with completed claim pruning", async () => {
    const cursor = ServiceAvailabilityReconciliationSchedulerCursor.create({
      completedThrough: "2026-07-26T12:30:00.000Z",
    });
    const read = vi
      .fn<ServiceAvailabilityReconciliationSchedulerCursorStore["read"]>()
      .mockResolvedValue(cursor);
    const advance =
      vi.fn<ServiceAvailabilityReconciliationSchedulerCursorStore["advance"]>();
    const claim =
      vi.fn<ServiceAvailabilityReconciliationOccurrenceClaimStore["claim"]>();
    const pruningResult = Object.freeze({ kind: "unchanged" } as const);
    const pruneCompletedThrough = vi
      .fn<
        ServiceAvailabilityReconciliationOccurrenceClaimStore["pruneCompletedThrough"]
      >()
      .mockResolvedValue(pruningResult);
    const cursorStore = { read, advance };
    const occurrenceClaimStore = { claim, pruneCompletedThrough };
    const capabilities = createServiceManagement(
      {},
      {
        serviceAvailabilityReconciliationSchedulerCursorStore: cursorStore,
        serviceAvailabilityReconciliationOccurrenceClaimStore:
          occurrenceClaimStore,
      },
    );

    expect(read).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(pruneCompletedThrough).not.toHaveBeenCalled();

    const result =
      await capabilities.pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims.execute();

    expect(result).toBe(pruningResult);
    expect(read).toHaveBeenCalledOnce();
    expect(pruneCompletedThrough).toHaveBeenCalledExactlyOnceWith(cursor);
    expect(claim).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it("keeps default scheduler cursor state isolated between compositions", async () => {
    const first = createServiceManagement(
      {},
      {
        clock: createClock(
          "2026-07-26T12:30:00.000Z",
          "2026-07-26T12:30:00.000Z",
        ),
      },
    );
    const second = createServiceManagement(
      {},
      {
        clock: createClock(
          "2026-07-26T12:30:00.000Z",
          "2026-07-26T12:30:00.000Z",
        ),
      },
    );

    const firstResult =
      await first.runServiceAvailabilityReconciliationSchedulerCycle.execute();
    const secondResult =
      await second.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(firstResult.kind).toBe("advanced");
    expect(secondResult.kind).toBe("advanced");
  });

  it("allows caller-owned cursor state sharing through an exact store override", async () => {
    const cursorStore =
      new InMemoryServiceAvailabilityReconciliationSchedulerCursorStore();
    const first = createServiceManagement(
      {},
      {
        clock: createClock(
          "2026-07-26T12:30:00.000Z",
          "2026-07-26T12:30:00.000Z",
        ),
        serviceAvailabilityReconciliationSchedulerCursorStore: cursorStore,
      },
    );
    const second = createServiceManagement(
      {},
      {
        clock: createClock("2026-07-26T12:30:00.000Z"),
        serviceAvailabilityReconciliationSchedulerCursorStore: cursorStore,
      },
    );

    const firstResult =
      await first.runServiceAvailabilityReconciliationSchedulerCycle.execute();
    const secondResult =
      await second.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(firstResult.kind).toBe("advanced");
    expect(secondResult.kind).toBe("idle");
  });

  it("keeps direct tick execution independent from scheduler cursor state", async () => {
    const clock = createClock(
      "2026-07-26T12:30:00.000Z",
      "2026-07-26T12:30:00.000Z",
    );
    const capabilities = createServiceManagement({}, { clock });

    await capabilities.runServiceAvailabilityReconciliationTick.execute(
      new Date("2026-07-26T12:29:00.000Z"),
      new Date("2026-07-26T12:30:00.000Z"),
    );
    const cycleResult =
      await capabilities.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(cycleResult.kind).toBe("advanced");
  });

  it("shares occurrence claims between direct and scheduler-cycle execution", async () => {
    const service = createConfiguredService("mock", {
      id: "atlas-api",
      availabilityPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
    });
    const clock = createClock(
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:01.000Z",
      "2026-07-27T12:00:45.000Z",
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:30:00.000Z",
    );
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });
    const occurrence = ServiceAvailabilityReconciliationOccurrence.create({
      serviceId: service.id,
      operation: "start",
      scheduledFor: "2026-07-27T12:00:00.000Z",
    });
    const orchestrate = vi
      .spyOn(capabilities.orchestrateRegisteredServiceControl, "execute")
      .mockResolvedValue(
        Object.freeze({
          targetServiceId: service.id,
          requestedOperation: "start" as const,
          startedAt: "2026-07-27T12:00:00.000Z",
          completedAt: "2026-07-27T12:00:01.000Z",
          steps: Object.freeze([]),
          successful: true,
        }),
      );

    const directResult =
      await capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      );
    const cycleResult =
      await capabilities.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(directResult.kind).toBe("executed");
    expect(cycleResult).toMatchObject({
      kind: "advanced",
      report: [
        {
          serviceId: service.id,
          occurrenceResults: [
            { kind: "completed", result: { kind: "duplicate" } },
          ],
        },
      ],
    });
    expect(orchestrate).toHaveBeenCalledTimes(1);
  });

  it("injects the exact exposed listing, generation, and occurrence execution instances into the tick", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "manual" },
    });
    const capabilities = createServiceManagement(createEnvironment([service]));
    const list = vi.spyOn(capabilities.listRegisteredServices, "execute");
    const generate = vi.spyOn(
      capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences,
      "execute",
    );
    const executeOccurrence = vi.spyOn(
      capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence,
      "execute",
    );
    const fromExclusive = new Date("2026-07-27T11:00:00.000Z");
    const toInclusive = new Date("2026-07-27T12:00:00.000Z");

    const result =
      await capabilities.runServiceAvailabilityReconciliationTick.execute(
        fromExclusive,
        toInclusive,
      );

    expect(list).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledExactlyOnceWith(
      service.id,
      fromExclusive,
      toInclusive,
    );
    expect(executeOccurrence).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        kind: "completed",
        serviceId: service.id,
        occurrenceResults: [],
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(
      result[0]?.kind === "completed" &&
        Object.isFrozen(result[0].occurrenceResults),
    ).toBe(true);
  });

  it("shares occurrence claims between direct execution and tick execution", async () => {
    const service = createConfiguredService("mock", {
      id: "atlas-api",
      availabilityPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
    });
    const clock = createClock(
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:01.000Z",
      "2026-07-27T12:00:00.000Z",
    );
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });
    const occurrence = ServiceAvailabilityReconciliationOccurrence.create({
      serviceId: service.id,
      operation: "start",
      scheduledFor: "2026-07-27T12:00:00.000Z",
    });
    const orchestrate = vi
      .spyOn(capabilities.orchestrateRegisteredServiceControl, "execute")
      .mockResolvedValue(
        Object.freeze({
          targetServiceId: service.id,
          requestedOperation: "start" as const,
          startedAt: "2026-07-27T12:00:00.000Z",
          completedAt: "2026-07-27T12:00:01.000Z",
          steps: Object.freeze([]),
          successful: true,
        }),
      );

    const directResult =
      await capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      );
    const tickResult =
      await capabilities.runServiceAvailabilityReconciliationTick.execute(
        new Date("2026-07-27T11:00:00.000Z"),
        new Date("2026-07-27T12:00:00.000Z"),
      );

    expect(directResult.kind).toBe("executed");
    expect(tickResult).toMatchObject([
      {
        kind: "completed",
        serviceId: service.id,
        occurrenceResults: [
          {
            kind: "completed",
            result: { kind: "duplicate" },
          },
        ],
      },
    ]);
    expect(orchestrate).toHaveBeenCalledTimes(1);

    const reverseClock = createClock(
      "2026-07-27T12:00:00.000Z",
      "2026-07-27T12:00:01.000Z",
      "2026-07-27T12:00:00.000Z",
    );
    const reverseCapabilities = createServiceManagement(
      createEnvironment([service]),
      {
        clock: reverseClock,
        mockStatusConfiguration: [
          { externalResourceId: service.externalResourceId, state: "stopped" },
        ],
      },
    );
    const reverseOrchestrate = vi
      .spyOn(reverseCapabilities.orchestrateRegisteredServiceControl, "execute")
      .mockResolvedValue(
        Object.freeze({
          targetServiceId: service.id,
          requestedOperation: "start" as const,
          startedAt: "2026-07-27T12:00:00.000Z",
          completedAt: "2026-07-27T12:00:01.000Z",
          steps: Object.freeze([]),
          successful: true,
        }),
      );

    const firstTickResult =
      await reverseCapabilities.runServiceAvailabilityReconciliationTick.execute(
        new Date("2026-07-27T11:00:00.000Z"),
        new Date("2026-07-27T12:00:00.000Z"),
      );
    const laterDirectResult =
      await reverseCapabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      );

    expect(firstTickResult).toMatchObject([
      {
        occurrenceResults: [
          { kind: "completed", result: { kind: "executed" } },
        ],
      },
    ]);
    expect(laterDirectResult).toEqual({ kind: "duplicate" });
    expect(reverseOrchestrate).toHaveBeenCalledTimes(1);
  });

  it("keeps tick claim state isolated between composition instances", async () => {
    const service = createConfiguredService("mock", {
      id: "atlas-api",
      availabilityPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
    });
    const createComposition = () =>
      createServiceManagement(createEnvironment([service]), {
        clock: createClock(
          "2026-07-27T12:00:00.000Z",
          "2026-07-27T12:00:01.000Z",
        ),
        mockStatusConfiguration: [
          { externalResourceId: service.externalResourceId, state: "stopped" },
        ],
      });
    const first = createComposition();
    const second = createComposition();
    vi.spyOn(
      first.orchestrateRegisteredServiceControl,
      "execute",
    ).mockResolvedValue(
      Object.freeze({
        targetServiceId: service.id,
        requestedOperation: "start" as const,
        startedAt: "2026-07-27T12:00:00.000Z",
        completedAt: "2026-07-27T12:00:01.000Z",
        steps: Object.freeze([]),
        successful: true,
      }),
    );
    vi.spyOn(
      second.orchestrateRegisteredServiceControl,
      "execute",
    ).mockResolvedValue(
      Object.freeze({
        targetServiceId: service.id,
        requestedOperation: "start" as const,
        startedAt: "2026-07-27T12:00:00.000Z",
        completedAt: "2026-07-27T12:00:01.000Z",
        steps: Object.freeze([]),
        successful: true,
      }),
    );
    const interval = [
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T12:00:00.000Z"),
    ] as const;

    const firstResult =
      await first.runServiceAvailabilityReconciliationTick.execute(...interval);
    const secondResult =
      await second.runServiceAvailabilityReconciliationTick.execute(
        ...interval,
      );

    expect(firstResult[0]?.kind).toBe("completed");
    expect(secondResult[0]?.kind).toBe("completed");
    if (
      firstResult[0]?.kind !== "completed" ||
      secondResult[0]?.kind !== "completed"
    ) {
      throw new Error("Expected completed tick service results");
    }
    expect(firstResult[0].occurrenceResults[0]).toMatchObject({
      kind: "completed",
      result: { kind: "executed" },
    });
    expect(secondResult[0].occurrenceResults[0]).toMatchObject({
      kind: "completed",
      result: { kind: "executed" },
    });
  });

  it("generates ordered occurrences from the same catalog-owned service policy", async () => {
    const service = createConfiguredService("mock", {
      id: "atlas-api",
      availabilityPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
    });
    const capabilities = createServiceManagement(createEnvironment([service]));

    const listedServices = await capabilities.listRegisteredServices.execute();
    const occurrences =
      await capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences.execute(
        listedServices[0]?.id ?? "",
        new Date("2026-07-27T11:00:00.000Z"),
        new Date("2026-07-27T20:00:00.000Z"),
      );

    expect(occurrences).toEqual([
      {
        serviceId: "atlas-api",
        operation: "start",
        scheduledFor: "2026-07-27T12:00:00.000Z",
      },
      {
        serviceId: "atlas-api",
        operation: "stop",
        scheduledFor: "2026-07-27T20:00:00.000Z",
      },
    ]);
    expect(Object.isFrozen(occurrences)).toBe(true);
    expect(occurrences.every(Object.isFrozen)).toBe(true);
  });

  it("repeats generation without status, control, claim, or clock behavior", async () => {
    const service = createConfiguredService("pm2", {
      id: "atlas-api",
      externalResourceId: "atlas-api-process",
      availabilityPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
    });
    const clock = createClock();
    const processListExecutor = createProcessListExecutor(
      JSON.stringify([createPm2Process("atlas-api-process")]),
    );
    const controlExecutor = createControlExecutor();
    const claim = vi
      .fn<ServiceAvailabilityReconciliationOccurrenceClaimStore["claim"]>()
      .mockResolvedValue(Object.freeze({ kind: "claimed" }));
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
      serviceAvailabilityReconciliationOccurrenceClaimStore: {
        claim,
        pruneCompletedThrough: vi.fn(),
      },
    });
    const interval = [
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T12:00:00.000Z"),
    ] as const;

    const first =
      await capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences.execute(
        service.id,
        ...interval,
      );
    const second =
      await capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences.execute(
        service.id,
        ...interval,
      );

    expect(second).toEqual(first);
    expect(clock.now).not.toHaveBeenCalled();
    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("keeps generation based on the base policy after an override is set", async () => {
    const service = createConfiguredService("mock", {
      id: "atlas-api",
      availabilityPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
    });
    const clock = createClock("2026-07-27T10:00:00.000Z");
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
    });

    await capabilities.setRegisteredServiceAvailabilityOverride.execute(
      service.id,
      {
        kind: "suspend_schedule",
        expiresAt: "2026-07-27T21:00:00.000Z",
      },
    );
    const occurrences =
      await capabilities.generateRegisteredServiceAvailabilityReconciliationOccurrences.execute(
        service.id,
        new Date("2026-07-27T11:00:00.000Z"),
        new Date("2026-07-27T20:00:00.000Z"),
      );

    expect(occurrences.map((occurrence) => occurrence.operation)).toEqual([
      "start",
      "stop",
    ]);
    expect(clock.now).toHaveBeenCalledTimes(1);
  });

  it("injects the exact exposed planning and orchestration instances into occurrence execution", async () => {
    const claim = vi
      .fn<ServiceAvailabilityReconciliationOccurrenceClaimStore["claim"]>()
      .mockResolvedValue({ kind: "claimed" });
    const claimStore = { claim, pruneCompletedThrough: vi.fn() };
    const capabilities = createServiceManagement(
      {},
      {
        serviceAvailabilityReconciliationOccurrenceClaimStore: claimStore,
      },
    );
    const occurrence = createOccurrence();
    const orchestrationResult = Object.freeze({
      targetServiceId: occurrence.serviceId,
      requestedOperation: occurrence.operation,
      startedAt: firstTimestamp,
      completedAt: firstTimestamp,
      steps: Object.freeze([]),
      successful: true,
    } as const);
    const planningExecute = vi
      .spyOn(
        capabilities.planRegisteredServiceAvailabilityReconciliation,
        "execute",
      )
      .mockResolvedValue({
        kind: "execute",
        operation: occurrence.operation,
      });
    const orchestrateExecute = vi
      .spyOn(capabilities.orchestrateRegisteredServiceControl, "execute")
      .mockResolvedValue(orchestrationResult);

    expect(claim).not.toHaveBeenCalled();

    const result =
      await capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      );

    expect(planningExecute).toHaveBeenCalledExactlyOnceWith(
      occurrence.serviceId,
    );
    expect(claim).toHaveBeenCalledExactlyOnceWith(occurrence);
    expect(orchestrateExecute).toHaveBeenCalledExactlyOnceWith(
      occurrence.serviceId,
      occurrence.operation,
      "scheduled",
    );
    expect(result).toEqual({
      kind: "executed",
      orchestrationResult,
    });
    if (result.kind === "executed") {
      expect(result.orchestrationResult).toBe(orchestrationResult);
    }
  });

  it("uses one private default claim store for repeated occurrence execution", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "always" },
    });
    const clock = createClock(firstTimestamp, secondTimestamp, firstTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });
    vi.spyOn(
      capabilities.orchestrateRegisteredServiceControl,
      "execute",
    ).mockResolvedValue(
      Object.freeze({
        targetServiceId: service.id,
        requestedOperation: "start" as const,
        startedAt: secondTimestamp,
        completedAt: secondTimestamp,
        steps: Object.freeze([]),
        successful: true,
      }),
    );
    const firstOccurrence = createOccurrence();
    const equivalentOccurrence = createOccurrence();

    expect(clock.now).not.toHaveBeenCalled();

    const first =
      await capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        firstOccurrence,
      );
    const duplicate =
      await capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        equivalentOccurrence,
      );

    expect(first).toMatchObject({
      kind: "executed",
      orchestrationResult: {
        targetServiceId: service.id,
        requestedOperation: "start",
        successful: true,
      },
    });
    expect(duplicate).toEqual({ kind: "duplicate" });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(duplicate)).toBe(true);
  });

  it("atomically suppresses concurrent equivalent occurrences in one composition", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "always" },
    });
    const occurrences = Array.from({ length: 10 }, () => createOccurrence());
    const clock = createClock(
      ...Array.from({ length: occurrences.length + 1 }, () => firstTimestamp),
    );
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });
    vi.spyOn(
      capabilities.orchestrateRegisteredServiceControl,
      "execute",
    ).mockResolvedValue(
      Object.freeze({
        targetServiceId: service.id,
        requestedOperation: "start" as const,
        startedAt: firstTimestamp,
        completedAt: firstTimestamp,
        steps: Object.freeze([]),
        successful: true,
      }),
    );

    const results = await Promise.all(
      occurrences.map((occurrence) =>
        capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
          occurrence,
        ),
      ),
    );

    expect(results.filter(({ kind }) => kind === "executed")).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === "duplicate")).toHaveLength(
      occurrences.length - 1,
    );
  });

  it.each([
    [{ kind: "none" }, "start"],
    [{ kind: "execute", operation: "stop" }, "start"],
    [{ kind: "execute", operation: "start" }, "stop"],
  ] as const)(
    "does not claim or control a non-applicable composed occurrence",
    async (decision, occurrenceOperation) => {
      const claim = vi
        .fn<ServiceAvailabilityReconciliationOccurrenceClaimStore["claim"]>()
        .mockResolvedValue({ kind: "claimed" });
      const capabilities = createServiceManagement(
        {},
        {
          serviceAvailabilityReconciliationOccurrenceClaimStore: {
            claim,
            pruneCompletedThrough: vi.fn(),
          },
        },
      );
      vi.spyOn(
        capabilities.planRegisteredServiceAvailabilityReconciliation,
        "execute",
      ).mockResolvedValue(decision);
      const controlExecute = vi.spyOn(
        capabilities.controlRegisteredService,
        "execute",
      );

      const result =
        await capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
          createOccurrence({ operation: occurrenceOperation }),
        );

      expect(result).toEqual({ kind: "none" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(claim).not.toHaveBeenCalled();
      expect(controlExecute).not.toHaveBeenCalled();
    },
  );

  it("keeps default occurrence claims isolated between composition instances", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "always" },
    });
    const environment = createEnvironment([service]);
    const statusConfiguration = [
      { externalResourceId: service.externalResourceId, state: "stopped" },
    ] as const;
    const first = createServiceManagement(environment, {
      clock: createClock(firstTimestamp, secondTimestamp),
      mockStatusConfiguration: statusConfiguration,
    });
    const second = createServiceManagement(environment, {
      clock: createClock(firstTimestamp, secondTimestamp),
      mockStatusConfiguration: statusConfiguration,
    });
    vi.spyOn(
      first.orchestrateRegisteredServiceControl,
      "execute",
    ).mockResolvedValue(
      Object.freeze({
        targetServiceId: service.id,
        requestedOperation: "start" as const,
        startedAt: firstTimestamp,
        completedAt: secondTimestamp,
        steps: Object.freeze([]),
        successful: true,
      }),
    );
    vi.spyOn(
      second.orchestrateRegisteredServiceControl,
      "execute",
    ).mockResolvedValue(
      Object.freeze({
        targetServiceId: service.id,
        requestedOperation: "start" as const,
        startedAt: firstTimestamp,
        completedAt: secondTimestamp,
        steps: Object.freeze([]),
        successful: true,
      }),
    );
    const occurrence = createOccurrence();

    await expect(
      first.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      ),
    ).resolves.toEqual(expect.objectContaining({ kind: "executed" }));
    await expect(
      second.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      ),
    ).resolves.toEqual(expect.objectContaining({ kind: "executed" }));
  });

  it("preserves an occurrence claim after composed orchestration rejects it", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "always" },
      supportedOperations: ["readStatus"],
    });
    const clock = createClock(firstTimestamp, firstTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });
    const occurrence = createOccurrence();

    await expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      ),
    ).rejects.toThrow("Orchestration failed");
    await expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      ),
    ).resolves.toEqual({ kind: "duplicate" });
  });

  it("propagates injected claim-store failures without fallback or control", async () => {
    const failure = new Error("claim store unavailable");
    const claim = vi
      .fn<ServiceAvailabilityReconciliationOccurrenceClaimStore["claim"]>()
      .mockRejectedValue(failure);
    const capabilities = createServiceManagement(
      {},
      {
        serviceAvailabilityReconciliationOccurrenceClaimStore: {
          claim,
          pruneCompletedThrough: vi.fn(),
        },
      },
    );
    const occurrence = createOccurrence();
    vi.spyOn(
      capabilities.planRegisteredServiceAvailabilityReconciliation,
      "execute",
    ).mockResolvedValue({
      kind: "execute",
      operation: occurrence.operation,
    });
    const controlExecute = vi.spyOn(
      capabilities.controlRegisteredService,
      "execute",
    );

    expect(claim).not.toHaveBeenCalled();

    await expect(
      capabilities.executeRegisteredServiceAvailabilityReconciliationOccurrence.execute(
        occurrence,
      ),
    ).rejects.toBe(failure);
    expect(claim).toHaveBeenCalledExactlyOnceWith(occurrence);
    expect(controlExecute).not.toHaveBeenCalled();
  });

  it("injects the exact exposed planning and control instances into execution", async () => {
    const capabilities = createServiceManagement({});
    const controlResult = {
      serviceId: "task-manager",
      operation: "start",
      completedAt: firstTimestamp,
    } as const;
    const planningExecute = vi
      .spyOn(
        capabilities.planRegisteredServiceAvailabilityReconciliation,
        "execute",
      )
      .mockResolvedValue({ kind: "execute", operation: "start" });
    const controlExecute = vi
      .spyOn(capabilities.controlRegisteredService, "execute")
      .mockResolvedValue(controlResult);

    const result =
      await capabilities.executeRegisteredServiceAvailabilityReconciliation.execute(
        " Task-Manager ",
      );

    expect(planningExecute).toHaveBeenCalledExactlyOnceWith(" Task-Manager ");
    expect(controlExecute).toHaveBeenCalledExactlyOnceWith(
      " Task-Manager ",
      "start",
    );
    expect(result).toEqual({ kind: "executed", controlResult });
    if (result.kind === "executed") {
      expect(result.controlResult).toBe(controlResult);
    }
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns none through composed execution without invoking shared control", async () => {
    const capabilities = createServiceManagement({});
    const planningExecute = vi
      .spyOn(
        capabilities.planRegisteredServiceAvailabilityReconciliation,
        "execute",
      )
      .mockResolvedValue({ kind: "none" });
    const controlExecute = vi.spyOn(
      capabilities.controlRegisteredService,
      "execute",
    );

    const result =
      await capabilities.executeRegisteredServiceAvailabilityReconciliation.execute(
        "missing-service",
      );

    expect(planningExecute).toHaveBeenCalledExactlyOnceWith("missing-service");
    expect(controlExecute).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "none" });
    expect(Object.keys(result)).toEqual(["kind"]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("shares override, mock status, controller, and clock with execution", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "manual" },
    });
    const clock = createClock(firstTimestamp, firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });

    expect(clock.now).not.toHaveBeenCalled();

    await capabilities.setRegisteredServiceAvailabilityOverride.execute(
      service.id,
      {
        kind: "keep_available",
        expiresAt: "2026-07-25T12:00:00.001Z",
      },
    );

    const result =
      await capabilities.executeRegisteredServiceAvailabilityReconciliation.execute(
        service.id,
      );

    expect(result).toEqual({
      kind: "executed",
      controlResult: {
        serviceId: service.id,
        operation: "start",
        completedAt: secondTimestamp,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind === "executed") {
      expect(Object.isFrozen(result.controlResult)).toBe(true);
    }
    expect(clock.now).toHaveBeenCalledTimes(3);
  });

  it("does not deduplicate repeated explicit composed execution", async () => {
    const capabilities = createServiceManagement({});
    const planningExecute = vi
      .spyOn(
        capabilities.planRegisteredServiceAvailabilityReconciliation,
        "execute",
      )
      .mockResolvedValue({ kind: "execute", operation: "stop" });
    const controlExecute = vi
      .spyOn(capabilities.controlRegisteredService, "execute")
      .mockResolvedValue({
        serviceId: "task-manager",
        operation: "stop",
        completedAt: firstTimestamp,
      });

    await capabilities.executeRegisteredServiceAvailabilityReconciliation.execute(
      "task-manager",
    );
    await capabilities.executeRegisteredServiceAvailabilityReconciliation.execute(
      "task-manager",
    );

    expect(planningExecute).toHaveBeenCalledTimes(2);
    expect(controlExecute).toHaveBeenCalledTimes(2);
  });

  it("shares one injected store with planning without using dependencies during composition", async () => {
    const service = createConfiguredService("mock");
    const clock = createClock(
      firstTimestamp,
      firstTimestamp,
      firstTimestamp,
      firstTimestamp,
      firstTimestamp,
    );
    const storedOverrides = new Map<string, ServiceAvailabilityOverride>();
    const findByServiceId = vi.fn<
      ServiceAvailabilityOverrideStore["findByServiceId"]
    >((serviceId) => Promise.resolve(storedOverrides.get(serviceId) ?? null));
    const save = vi.fn<ServiceAvailabilityOverrideStore["save"]>(
      (serviceId, override) => {
        storedOverrides.set(serviceId, override);
        return Promise.resolve();
      },
    );
    const removeByServiceId = vi.fn<
      ServiceAvailabilityOverrideStore["removeByServiceId"]
    >((serviceId) => {
      storedOverrides.delete(serviceId);
      return Promise.resolve();
    });
    const removeByServiceIdIfMatches = vi.fn<
      ServiceAvailabilityOverrideStore["removeByServiceIdIfMatches"]
    >(() => Promise.resolve(Object.freeze({ kind: "not_removed" })));
    const store: ServiceAvailabilityOverrideStore = {
      findByServiceId,
      save,
      removeByServiceId,
      removeByServiceIdIfMatches,
    };
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      serviceAvailabilityOverrideStore: store,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });

    expect(clock.now).not.toHaveBeenCalled();
    expect(findByServiceId).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(removeByServiceId).not.toHaveBeenCalled();
    expect(removeByServiceIdIfMatches).not.toHaveBeenCalled();

    const created =
      await capabilities.setRegisteredServiceAvailabilityOverride.execute(
        service.id,
        {
          kind: "keep_available",
          expiresAt: "2026-07-25T12:00:00.001Z",
        },
      );

    expect(clock.now).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledExactlyOnceWith(service.id, created);
    await expect(
      capabilities.getRegisteredServiceEffectiveAvailability.execute(
        service.id,
      ),
    ).resolves.toBe("available");
    expect(findByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
    expect(clock.now).toHaveBeenCalledTimes(2);
    await expect(
      capabilities.planRegisteredServiceAvailabilityReconciliation.execute(
        service.id,
      ),
    ).resolves.toEqual({ kind: "execute", operation: "start" });
    expect(findByServiceId).toHaveBeenCalledTimes(2);
    expect(clock.now).toHaveBeenCalledTimes(3);

    const list = vi.spyOn(capabilities.listRegisteredServices, "execute");
    await expect(
      capabilities.pruneExpiredRegisteredServiceAvailabilityOverrides.execute(),
    ).resolves.toEqual([{ kind: "active", serviceId: service.id }]);
    expect(list).toHaveBeenCalledOnce();
    expect(findByServiceId).toHaveBeenCalledTimes(3);
    expect(clock.now).toHaveBeenCalledTimes(4);
    expect(removeByServiceIdIfMatches).not.toHaveBeenCalled();

    await expect(
      capabilities.cancelRegisteredServiceAvailabilityOverride.execute(
        service.id,
      ),
    ).resolves.toBeUndefined();

    expect(removeByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
    await expect(
      capabilities.getRegisteredServiceEffectiveAvailability.execute(
        service.id,
      ),
    ).resolves.toBe("manual");
    expect(findByServiceId).toHaveBeenCalledTimes(4);
    expect(clock.now).toHaveBeenCalledTimes(5);
  });

  it("shares status, override state, and clock across planning transitions", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "manual" },
      supportedOperations: ["readStatus"],
    });
    const clock = createClock(
      firstTimestamp,
      firstTimestamp,
      firstTimestamp,
      firstTimestamp,
      firstTimestamp,
    );
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });

    expect(clock.now).not.toHaveBeenCalled();

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).resolves.toEqual({
      serviceId: service.id,
      state: "stopped",
      observedAt: firstTimestamp,
    });
    await expect(
      capabilities.planRegisteredServiceAvailabilityReconciliation.execute(
        service.id,
      ),
    ).resolves.toEqual({ kind: "none" });

    await capabilities.setRegisteredServiceAvailabilityOverride.execute(
      service.id,
      {
        kind: "keep_available",
        expiresAt: "2026-07-25T12:00:00.001Z",
      },
    );
    await expect(
      capabilities.planRegisteredServiceAvailabilityReconciliation.execute(
        service.id,
      ),
    ).resolves.toEqual({ kind: "execute", operation: "start" });

    await capabilities.cancelRegisteredServiceAvailabilityOverride.execute(
      service.id,
    );
    await expect(
      capabilities.planRegisteredServiceAvailabilityReconciliation.execute(
        service.id,
      ),
    ).resolves.toEqual({ kind: "none" });
    expect(clock.now).toHaveBeenCalledTimes(5);
  });

  it("makes override replacement immediately visible to planning", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "manual" },
    });
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock: createClock(
        firstTimestamp,
        firstTimestamp,
        firstTimestamp,
        firstTimestamp,
      ),
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });

    await capabilities.setRegisteredServiceAvailabilityOverride.execute(
      service.id,
      {
        kind: "keep_available",
        expiresAt: "2026-07-25T12:00:00.001Z",
      },
    );
    await expect(
      capabilities.planRegisteredServiceAvailabilityReconciliation.execute(
        service.id,
      ),
    ).resolves.toEqual({ kind: "execute", operation: "start" });

    await capabilities.setRegisteredServiceAvailabilityOverride.execute(
      service.id,
      {
        kind: "suspend_schedule",
        expiresAt: "2026-07-25T12:00:00.002Z",
      },
    );
    await expect(
      capabilities.planRegisteredServiceAvailabilityReconciliation.execute(
        service.id,
      ),
    ).resolves.toEqual({ kind: "none" });
  });

  it("keeps default planning state isolated between composition instances", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "manual" },
    });
    const compositionOverrides = {
      clock: createClock(firstTimestamp, firstTimestamp),
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    };
    const first = createServiceManagement(
      createEnvironment([service]),
      compositionOverrides,
    );
    const second = createServiceManagement(createEnvironment([service]), {
      ...compositionOverrides,
      clock: createClock(firstTimestamp),
    });

    await first.setRegisteredServiceAvailabilityOverride.execute(service.id, {
      kind: "keep_available",
      expiresAt: "2026-07-25T12:00:00.001Z",
    });

    await expect(
      first.planRegisteredServiceAvailabilityReconciliation.execute(service.id),
    ).resolves.toEqual({ kind: "execute", operation: "start" });
    await expect(
      second.planRegisteredServiceAvailabilityReconciliation.execute(
        service.id,
      ),
    ).resolves.toEqual({ kind: "none" });
  });

  it("shares the default store between set, cancel, and query", async () => {
    const service = createConfiguredService("mock");
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock: createClock(firstTimestamp, firstTimestamp, firstTimestamp),
    });

    await capabilities.setRegisteredServiceAvailabilityOverride.execute(
      service.id,
      {
        kind: "suspend_schedule",
        expiresAt: "2026-07-25T12:00:00.001Z",
      },
    );
    await expect(
      capabilities.getRegisteredServiceEffectiveAvailability.execute(
        service.id,
      ),
    ).resolves.toBe("manual");

    await expect(
      capabilities.cancelRegisteredServiceAvailabilityOverride.execute(
        service.id,
      ),
    ).resolves.toBeUndefined();
    await expect(
      capabilities.getRegisteredServiceEffectiveAvailability.execute(
        service.id,
      ),
    ).resolves.toBe("manual");
    await expect(
      capabilities.cancelRegisteredServiceAvailabilityOverride.execute(
        service.id,
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps default override state and queries isolated between composition instances", async () => {
    const service = createConfiguredService("mock", {
      availabilityPolicy: { mode: "manual" },
    });
    const first = createServiceManagement(createEnvironment([service]), {
      clock: createClock(firstTimestamp, firstTimestamp),
    });
    const second = createServiceManagement(createEnvironment([service]), {
      clock: createClock(firstTimestamp, firstTimestamp),
    });

    await first.setRegisteredServiceAvailabilityOverride.execute(service.id, {
      kind: "keep_available",
      expiresAt: "2026-07-25T12:00:00.001Z",
    });

    await expect(
      first.getRegisteredServiceEffectiveAvailability.execute(service.id),
    ).resolves.toBe("available");
    await expect(
      second.getRegisteredServiceEffectiveAvailability.execute(service.id),
    ).resolves.toBe("manual");

    await first.cancelRegisteredServiceAvailabilityOverride.execute(service.id);
    await expect(
      second.getRegisteredServiceEffectiveAvailability.execute(service.id),
    ).resolves.toBe("manual");
  });

  it("makes override replacement immediately visible to the composed query", async () => {
    const service = createConfiguredService("mock");
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock: createClock(
        firstTimestamp,
        firstTimestamp,
        firstTimestamp,
        firstTimestamp,
      ),
    });

    await capabilities.setRegisteredServiceAvailabilityOverride.execute(
      service.id,
      {
        kind: "keep_available",
        expiresAt: "2026-07-25T12:00:00.001Z",
      },
    );
    await expect(
      capabilities.getRegisteredServiceEffectiveAvailability.execute(
        service.id,
      ),
    ).resolves.toBe("available");

    await capabilities.setRegisteredServiceAvailabilityOverride.execute(
      service.id,
      {
        kind: "suspend_schedule",
        expiresAt: "2026-07-25T12:00:00.002Z",
      },
    );
    await expect(
      capabilities.getRegisteredServiceEffectiveAvailability.execute(
        service.id,
      ),
    ).resolves.toBe("manual");
  });

  it("prevents capability replacement through the runtime bundle", () => {
    const capabilities = createServiceManagement({});

    expect(() => {
      (
        capabilities as {
          listRegisteredServices: ListRegisteredServices;
        }
      ).listRegisteredServices = new ListRegisteredServices({
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(null),
      });
    }).toThrow(TypeError);
    expect(() => {
      (
        capabilities as {
          executeRegisteredServiceAvailabilityReconciliationOccurrence: ExecuteRegisteredServiceAvailabilityReconciliationOccurrence;
        }
      ).executeRegisteredServiceAvailabilityReconciliationOccurrence =
        new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
          capabilities.planRegisteredServiceAvailabilityReconciliation,
          {
            claim: vi.fn().mockResolvedValue({ kind: "claimed" }),
            pruneCompletedThrough: vi.fn(),
          },
          capabilities.orchestrateRegisteredServiceControl,
        );
    }).toThrow(TypeError);
    expect(() => {
      (
        capabilities as {
          executeRegisteredServiceAvailabilityReconciliation: ExecuteRegisteredServiceAvailabilityReconciliation;
        }
      ).executeRegisteredServiceAvailabilityReconciliation =
        new ExecuteRegisteredServiceAvailabilityReconciliation(
          capabilities.planRegisteredServiceAvailabilityReconciliation,
          capabilities.controlRegisteredService,
        );
    }).toThrow(TypeError);
    expect(
      Reflect.deleteProperty(
        capabilities,
        "executeRegisteredServiceAvailabilityReconciliation",
      ),
    ).toBe(false);
    expect(
      Reflect.deleteProperty(
        capabilities,
        "executeRegisteredServiceAvailabilityReconciliationOccurrence",
      ),
    ).toBe(false);
  });

  it("uses an empty catalog when registered-service configuration is absent", async () => {
    const capabilities = createServiceManagement({});

    await expect(
      capabilities.listRegisteredServices.execute(),
    ).resolves.toEqual([]);
    await expect(
      capabilities.getRegisteredServiceStatus.execute("missing-service"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "registered_service_not_found" }),
    );
    await expect(
      capabilities.controlRegisteredService.execute("missing-service", "start"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "registered_service_not_found" }),
    );
  });

  it("lists configured mock and PM2 services in environment order", async () => {
    const services = [
      createConfiguredService("pm2", { id: "first-service" }),
      createConfiguredService("mock", { id: "second-service" }),
      createConfiguredService("pm2", {
        id: "third-service",
        externalResourceId: "third-target",
      }),
    ];
    const capabilities = createServiceManagement(createEnvironment(services));

    const listedServices = await capabilities.listRegisteredServices.execute();

    expect(listedServices.map((service) => service.id)).toEqual([
      "first-service",
      "second-service",
      "third-service",
    ]);
    expect(listedServices.map((service) => service.availabilityPolicy)).toEqual(
      [
        { mode: "manual", timezone: null, schedule: null },
        { mode: "manual", timezone: null, schedule: null },
        { mode: "manual", timezone: null, schedule: null },
      ],
    );
  });

  it.each([
    ["malformed configuration", { REGISTERED_SERVICES_JSON: "not-json" }],
    [
      "duplicate service IDs",
      createEnvironment([
        createConfiguredService("mock", { id: "duplicate-service" }),
        createConfiguredService("pm2", { id: "duplicate-service" }),
      ]),
    ],
    [
      "duplicate adapter-owned resources",
      createEnvironment([
        createConfiguredService("mock", {
          id: "first-service",
          externalResourceId: "duplicate-target",
        }),
        createConfiguredService("mock", {
          id: "second-service",
          externalResourceId: "duplicate-target",
        }),
      ]),
    ],
  ])("propagates safe catalog composition failure for %s", (_label, env) => {
    expect(() => createServiceManagement(env)).toThrowError(
      expect.objectContaining({
        name: "RegisteredServiceConfigurationError",
      }),
    );
  });

  it("shares the injected clock between status and control without calling it during composition", async () => {
    const service = createConfiguredService("mock");
    const clock = createClock(firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "running" },
      ],
    });

    expect(clock.now).not.toHaveBeenCalled();

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).resolves.toEqual({
      serviceId: service.id,
      state: "running",
      observedAt: firstTimestamp,
    });
    await expect(
      capabilities.controlRegisteredService.execute(service.id, "restart"),
    ).resolves.toEqual({
      serviceId: service.id,
      operation: "restart",
      completedAt: secondTimestamp,
    });
    expect(clock.now).toHaveBeenCalledTimes(2);
  });

  it("provides a lazy default system clock", async () => {
    const service = createConfiguredService("mock");
    const capabilities = createServiceManagement(createEnvironment([service]), {
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });

    const result = await capabilities.getRegisteredServiceStatus.execute(
      service.id,
    );

    expect(new Date(result.observedAt).toISOString()).toBe(result.observedAt);
  });

  it("does not call the clock after mock status failure", async () => {
    const service = createConfiguredService("mock");
    const clock = createClock(firstTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
    });

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).rejects.toEqual(
      expect.objectContaining({ code: "service_status_unavailable" }),
    );
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("accepts configured mock status and keeps mock control stateless", async () => {
    const service = createConfiguredService("mock");
    const clock = createClock(firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "running" },
      ],
    });

    await capabilities.controlRegisteredService.execute(service.id, "stop");

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).resolves.toEqual({
      serviceId: service.id,
      state: "running",
      observedAt: secondTimestamp,
    });
  });

  it.each([
    [
      "an invalid mock state",
      [{ externalResourceId: "mock-target", state: "starting" }],
      "invalid_mock_status_state",
    ],
    [
      "duplicate mock targets",
      [
        { externalResourceId: "mock-target", state: "running" },
        { externalResourceId: "mock-target", state: "stopped" },
      ],
      "duplicate_mock_status_target",
    ],
  ] as const)(
    "prevents composition for %s",
    (_description, mockStatusConfiguration, expectedCode) => {
      expect(() =>
        createServiceManagement({}, { mockStatusConfiguration }),
      ).toThrowError(expect.objectContaining({ code: expectedCode }));
    },
  );

  it("routes mock capabilities without invoking PM2 executors", async () => {
    const service = createConfiguredService("mock");
    const processListExecutor = createProcessListExecutor(
      JSON.stringify([createPm2Process()]),
    );
    const controlExecutor = createControlExecutor();
    const clock = createClock(firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "failed" },
      ],
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    await capabilities.getRegisteredServiceStatus.execute(service.id);
    await capabilities.controlRegisteredService.execute(service.id, "start");

    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it("shares the supplied PM2 process-list executor across status and control", async () => {
    const service = createConfiguredService("pm2");
    const processListExecutor = createProcessListExecutor(
      JSON.stringify([
        createPm2Process(service.externalResourceId, 42, "online"),
      ]),
    );
    const controlExecutor = createControlExecutor();
    const clock = createClock(firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).resolves.toEqual({
      serviceId: service.id,
      state: "running",
      observedAt: firstTimestamp,
    });
    expect(processListExecutor.execute).toHaveBeenCalledTimes(1);
    expect(controlExecutor.execute).not.toHaveBeenCalled();

    await expect(
      capabilities.controlRegisteredService.execute(service.id, "restart"),
    ).resolves.toEqual({
      serviceId: service.id,
      operation: "restart",
      completedAt: secondTimestamp,
    });
    expect(processListExecutor.execute).toHaveBeenCalledTimes(2);
    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "restart",
      42,
    );
    expect(
      processListExecutor.execute.mock.invocationCallOrder[1],
    ).toBeLessThan(controlExecutor.execute.mock.invocationCallOrder[0] ?? 0);
  });

  it("prevents clock access and fallback after PM2 controller failure", async () => {
    const service = createConfiguredService("pm2");
    const processListExecutor = createProcessListExecutor("[]");
    const controlExecutor = createControlExecutor();
    const clock = createClock(firstTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    await expect(
      capabilities.controlRegisteredService.execute(service.id, "stop"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "pm2_control_target_not_found" }),
    );
    expect(controlExecutor.execute).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("enforces supported operations before PM2 execution", async () => {
    const service = createConfiguredService("pm2", {
      supportedOperations: ["readStatus"],
    });
    const processListExecutor = createProcessListExecutor(
      JSON.stringify([createPm2Process(service.externalResourceId)]),
    );
    const controlExecutor = createControlExecutor();
    const capabilities = createServiceManagement(createEnvironment([service]), {
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    await expect(
      capabilities.controlRegisteredService.execute(service.id, "start"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "service_operation_not_supported" }),
    );
    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it("captures override dependencies and configuration during composition", async () => {
    const mockService = createConfiguredService("mock");
    const pm2Service = createConfiguredService("pm2");
    const originalClock = createClock(firstTimestamp, secondTimestamp);
    const replacementClock = createClock(secondTimestamp);
    const originalProcessListExecutor = createProcessListExecutor(
      JSON.stringify([
        createPm2Process(pm2Service.externalResourceId, 42, "online"),
      ]),
    );
    const replacementProcessListExecutor = createProcessListExecutor("[]");
    const originalControlExecutor = createControlExecutor();
    const replacementControlExecutor = createControlExecutor();
    const mockStatusConfiguration: MockServiceStatusConfiguration[] = [
      { externalResourceId: mockService.externalResourceId, state: "unknown" },
    ];
    const overrides: {
      clock: Clock;
      mockStatusConfiguration: readonly MockServiceStatusConfiguration[];
      pm2ProcessListExecutor: Pm2ProcessListExecutor;
      pm2ControlExecutor: Pm2ServiceControlExecutor;
    } = {
      clock: originalClock,
      mockStatusConfiguration,
      pm2ProcessListExecutor: originalProcessListExecutor,
      pm2ControlExecutor: originalControlExecutor,
    };
    const capabilities = createServiceManagement(
      createEnvironment([mockService, pm2Service]),
      overrides,
    );

    overrides.clock = replacementClock;
    overrides.mockStatusConfiguration = [];
    overrides.pm2ProcessListExecutor = replacementProcessListExecutor;
    overrides.pm2ControlExecutor = replacementControlExecutor;
    mockStatusConfiguration[0] = {
      externalResourceId: mockService.externalResourceId,
      state: "failed",
    };

    await expect(
      capabilities.getRegisteredServiceStatus.execute(mockService.id),
    ).resolves.toEqual({
      serviceId: mockService.id,
      state: "unknown",
      observedAt: firstTimestamp,
    });
    await expect(
      capabilities.controlRegisteredService.execute(pm2Service.id, "restart"),
    ).resolves.toEqual({
      serviceId: pm2Service.id,
      operation: "restart",
      completedAt: secondTimestamp,
    });
    expect(originalProcessListExecutor.execute).toHaveBeenCalledOnce();
    expect(originalControlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "restart",
      42,
    );
    expect(replacementClock.now).not.toHaveBeenCalled();
    expect(replacementProcessListExecutor.execute).not.toHaveBeenCalled();
    expect(replacementControlExecutor.execute).not.toHaveBeenCalled();
  });

  it("does not mutate environment or overrides during composition", () => {
    const environment = createEnvironment([createConfiguredService("mock")]);
    const clock = createClock(firstTimestamp);
    const processListExecutor = createProcessListExecutor("[]");
    const controlExecutor = createControlExecutor();
    const overrides: ServiceManagementCompositionOverrides = {
      clock,
      mockStatusConfiguration: [],
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    };
    const environmentSnapshot = { ...environment };
    const overrideEntries = Object.entries(overrides);

    createServiceManagement(environment, overrides);

    expect(environment).toEqual(environmentSnapshot);
    expect(Object.entries(overrides)).toEqual(overrideEntries);
    expect(clock.now).not.toHaveBeenCalled();
    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it("introduces no timer or signal-listener side effect during composition", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      createServiceManagement({});

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
