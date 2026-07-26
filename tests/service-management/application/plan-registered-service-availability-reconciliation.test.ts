import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "../../../src/service-management/application/ports/service-availability-override-store.js";
import type { ServiceStatusReader } from "../../../src/service-management/application/ports/service-status-reader.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/plan-registered-service-availability-reconciliation.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { ServiceAvailabilityReconciliationDecision } from "../../../src/service-management/domain/service-availability-reconciliation-decision.js";
import type { ServiceRuntimeState } from "../../../src/service-management/domain/registered-service-status.js";
import {
  createServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../../src/service-scheduling/domain/service-availability-override.js";
import type { ServiceAvailabilityExpectation } from "../../../src/service-scheduling/domain/service-availability-policy-evaluator.js";

const reconciliationTimestamp = "2026-08-03T13:00:00.000Z";

const policiesByExpectation: Readonly<
  Record<ServiceAvailabilityExpectation, unknown>
> = Object.freeze({
  available: { mode: "always" },
  unavailable: {
    mode: "scheduled",
    timezone: "America/Sao_Paulo",
    windows: [{ weekday: "monday", start: "11:00", end: "12:00" }],
  },
  manual: { mode: "manual" },
  disabled: { mode: "disabled" },
});

function expectedDecision(
  expectation: ServiceAvailabilityExpectation,
  runtimeState: ServiceRuntimeState,
): ServiceAvailabilityReconciliationDecision {
  if (expectation === "available" && runtimeState === "stopped") {
    return { kind: "execute", operation: "start" };
  }

  if (expectation === "unavailable" && runtimeState === "running") {
    return { kind: "execute", operation: "stop" };
  }

  return { kind: "none" };
}

function createService(
  availabilityPolicy: unknown,
  options: {
    readonly id?: string;
    readonly supportedOperations?: readonly string[];
  } = {},
): RegisteredService {
  return RegisteredService.create({
    id: options.id ?? "catalog-owned-service",
    displayName: "Catalog Owned Service",
    managementAdapter: "mock",
    externalResourceId: "private-infrastructure-target",
    supportedOperations: options.supportedOperations ?? ["readStatus"],
    availabilityPolicy,
  });
}

function createCatalog(
  findById: RegisteredServiceCatalog["findById"],
): RegisteredServiceCatalog {
  return {
    list: vi.fn(),
    findById,
  };
}

function createStore(
  override: ServiceAvailabilityOverride | null,
): ServiceAvailabilityOverrideStore & {
  readonly findByServiceId: ReturnType<
    typeof vi.fn<ServiceAvailabilityOverrideStore["findByServiceId"]>
  >;
  readonly save: ReturnType<
    typeof vi.fn<ServiceAvailabilityOverrideStore["save"]>
  >;
  readonly removeByServiceId: ReturnType<
    typeof vi.fn<ServiceAvailabilityOverrideStore["removeByServiceId"]>
  >;
  readonly removeByServiceIdIfMatches: ReturnType<
    typeof vi.fn<ServiceAvailabilityOverrideStore["removeByServiceIdIfMatches"]>
  >;
} {
  return {
    findByServiceId: vi
      .fn<ServiceAvailabilityOverrideStore["findByServiceId"]>()
      .mockResolvedValue(override),
    save: vi
      .fn<ServiceAvailabilityOverrideStore["save"]>()
      .mockRejectedValue(new Error("save must not be called")),
    removeByServiceId: vi
      .fn<ServiceAvailabilityOverrideStore["removeByServiceId"]>()
      .mockRejectedValue(new Error("remove must not be called")),
    removeByServiceIdIfMatches: vi
      .fn<ServiceAvailabilityOverrideStore["removeByServiceIdIfMatches"]>()
      .mockRejectedValue(new Error("conditional remove must not be called")),
  };
}

function createStatusReader(
  runtimeState: ServiceRuntimeState,
): ServiceStatusReader & {
  readonly read: ReturnType<typeof vi.fn<ServiceStatusReader["read"]>>;
} {
  return {
    read: vi.fn<ServiceStatusReader["read"]>().mockResolvedValue(runtimeState),
  };
}

function createClock(instant = new Date(reconciliationTimestamp)): Clock & {
  readonly now: ReturnType<typeof vi.fn<Clock["now"]>>;
} {
  return {
    now: vi.fn<Clock["now"]>().mockReturnValue(instant),
  };
}

function createUseCase(
  service: RegisteredService,
  runtimeState: ServiceRuntimeState,
  override: ServiceAvailabilityOverride | null = null,
  instant = new Date(reconciliationTimestamp),
): {
  readonly useCase: PlanRegisteredServiceAvailabilityReconciliation;
  readonly findById: ReturnType<typeof vi.fn>;
  readonly store: ReturnType<typeof createStore>;
  readonly statusReader: ReturnType<typeof createStatusReader>;
  readonly clock: ReturnType<typeof createClock>;
} {
  const findById = vi.fn().mockResolvedValue(service);
  const store = createStore(override);
  const statusReader = createStatusReader(runtimeState);
  const clock = createClock(instant);

  return {
    useCase: new PlanRegisteredServiceAvailabilityReconciliation(
      createCatalog(findById),
      store,
      statusReader,
      clock,
    ),
    findById,
    store,
    statusReader,
    clock,
  };
}

function createOverride(
  kind: "keep_available" | "suspend_schedule",
  expiresAt = "2026-08-03T13:00:00.001Z",
): ServiceAvailabilityOverride {
  return createServiceAvailabilityOverride(
    { kind, expiresAt },
    new Date("2026-08-01T12:00:00.000Z"),
  );
}

describe("PlanRegisteredServiceAvailabilityReconciliation", () => {
  it.each(["available", "unavailable", "manual", "disabled"] as const)(
    "plans the complete %s expectation matrix",
    async (expectation) => {
      for (const runtimeState of [
        "running",
        "stopped",
        "failed",
        "unknown",
      ] as const) {
        const service = createService(policiesByExpectation[expectation]);
        const { useCase, store, statusReader, clock } = createUseCase(
          service,
          runtimeState,
        );

        const decision = await useCase.execute(service.id);

        expect(decision).toEqual(expectedDecision(expectation, runtimeState));
        expect(Object.isFrozen(decision)).toBe(true);
        expect(decision).not.toHaveProperty("operation", "restart");
        expect(store.findByServiceId).toHaveBeenCalledExactlyOnceWith(
          service.id,
        );
        expect(statusReader.read).toHaveBeenCalledExactlyOnceWith(service);
        expect(clock.now).toHaveBeenCalledOnce();
        expect(store.save).not.toHaveBeenCalled();
        expect(store.removeByServiceId).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["keep_available", { mode: "manual" }, "stopped", "start"],
    ["suspend_schedule", { mode: "always" }, "running", null],
    ["keep_available", { mode: "disabled" }, "stopped", null],
    ["suspend_schedule", { mode: "disabled" }, "running", null],
  ] as const)(
    "preserves active %s override precedence",
    async (kind, policy, runtimeState, operation) => {
      const service = createService(policy);
      const override = createOverride(kind);
      const { useCase, store } = createUseCase(service, runtimeState, override);

      const decision = await useCase.execute(service.id);

      expect(decision).toEqual(
        operation === null ? { kind: "none" } : { kind: "execute", operation },
      );
      expect(store.findByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
      expect(store.save).not.toHaveBeenCalled();
      expect(store.removeByServiceId).not.toHaveBeenCalled();
      expect(override).toBe(override);
    },
  );

  it.each([
    ["keep_available", "2026-08-03T13:00:00.000Z"],
    ["suspend_schedule", "2026-08-03T12:59:59.999Z"],
    ["keep_available", "2026-08-02T13:00:00.000Z"],
  ] as const)(
    "passes an expired %s override through without cleanup",
    async (kind, expiresAt) => {
      const service = createService({ mode: "manual" });
      const override = createOverride(kind, expiresAt);
      const { useCase, store } = createUseCase(service, "stopped", override);

      await expect(useCase.execute(service.id)).resolves.toEqual({
        kind: "none",
      });
      expect(store.save).not.toHaveBeenCalled();
      expect(store.removeByServiceId).not.toHaveBeenCalled();
      expect(override.expiresAt).toBe(expiresAt);
    },
  );

  it("uses catalog-owned inputs and follows the required dependency order", async () => {
    const trace: string[] = [];
    const requestedId = " Requested-Service ";
    const service = createService({ mode: "always" });
    const catalog = createCatalog(
      vi.fn((serviceId) => {
        trace.push(`catalog:${serviceId}`);
        return Promise.resolve(service);
      }),
    );
    const store = createStore(null);
    store.findByServiceId.mockImplementation((serviceId) => {
      trace.push(`store:${serviceId}`);
      return Promise.resolve(null);
    });
    const statusReader = createStatusReader("stopped");
    statusReader.read.mockImplementation((target) => {
      trace.push(`status:${target.id}`);
      return Promise.resolve("stopped");
    });
    const clock = createClock();
    clock.now.mockImplementation(() => {
      trace.push("clock");
      return new Date(reconciliationTimestamp);
    });
    const useCase = new PlanRegisteredServiceAvailabilityReconciliation(
      catalog,
      store,
      statusReader,
      clock,
    );

    const decision = await useCase.execute(requestedId);
    trace.push("return");

    expect(decision).toEqual({ kind: "execute", operation: "start" });
    expect(trace).toEqual([
      `catalog:${requestedId}`,
      `store:${service.id}`,
      `status:${service.id}`,
      "clock",
      "return",
    ]);
    expect(store.findByServiceId).not.toHaveBeenCalledWith(requestedId);
    expect(store.findByServiceId).not.toHaveBeenCalledWith(service.displayName);
    expect(store.findByServiceId).not.toHaveBeenCalledWith(
      service.externalResourceId,
    );
    expect(statusReader.read).toHaveBeenCalledExactlyOnceWith(service);
  });

  it("rejects an unknown service before later dependencies", async () => {
    const store = createStore(null);
    const statusReader = createStatusReader("running");
    const clock = createClock();
    const useCase = new PlanRegisteredServiceAvailabilityReconciliation(
      createCatalog(vi.fn().mockResolvedValue(null)),
      store,
      statusReader,
      clock,
    );

    await expect(useCase.execute("unknown-service")).rejects.toEqual(
      expect.objectContaining({
        name: "RegisteredServiceNotFoundError",
        code: "registered_service_not_found",
      }),
    );
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(statusReader.read).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("propagates catalog failure by identity", async () => {
    const failure = new Error("sentinel-catalog-failure");
    const store = createStore(null);
    const statusReader = createStatusReader("running");
    const clock = createClock();
    const useCase = new PlanRegisteredServiceAvailabilityReconciliation(
      createCatalog(vi.fn().mockRejectedValue(failure)),
      store,
      statusReader,
      clock,
    );

    await expect(useCase.execute("example-service")).rejects.toBe(failure);
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(statusReader.read).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("propagates store failure before status and clock access", async () => {
    const service = createService({ mode: "always" });
    const failure = new Error("sentinel-store-failure");
    const store = createStore(null);
    store.findByServiceId.mockRejectedValue(failure);
    const statusReader = createStatusReader("running");
    const clock = createClock();
    const useCase = new PlanRegisteredServiceAvailabilityReconciliation(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      statusReader,
      clock,
    );

    await expect(useCase.execute(service.id)).rejects.toBe(failure);
    expect(statusReader.read).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.removeByServiceId).not.toHaveBeenCalled();
  });

  it("propagates status failure before clock access", async () => {
    const service = createService({ mode: "always" });
    const failure = new Error("sentinel-status-failure");
    const store = createStore(null);
    const read = vi
      .fn<ServiceStatusReader["read"]>()
      .mockRejectedValue(failure);
    const clock = createClock();
    const useCase = new PlanRegisteredServiceAvailabilityReconciliation(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      { read },
      clock,
    );

    await expect(useCase.execute(service.id)).rejects.toBe(failure);
    expect(store.findByServiceId).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledExactlyOnceWith(service);
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("propagates clock failure after all reads", async () => {
    const service = createService({ mode: "always" });
    const failure = new Error("sentinel-clock-failure");
    const store = createStore(null);
    const statusReader = createStatusReader("running");
    const now = vi.fn<Clock["now"]>(() => {
      throw failure;
    });
    const useCase = new PlanRegisteredServiceAvailabilityReconciliation(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      statusReader,
      { now },
    );

    await expect(useCase.execute(service.id)).rejects.toBe(failure);
    expect(store.findByServiceId).toHaveBeenCalledOnce();
    expect(statusReader.read).toHaveBeenCalledOnce();
    expect(now).toHaveBeenCalledOnce();
  });

  it("preserves invalid-instant evaluator errors", async () => {
    const service = createService({ mode: "always" });
    const { useCase, store, statusReader, clock } = createUseCase(
      service,
      "stopped",
      null,
      new Date(Number.NaN),
    );

    await expect(useCase.execute(service.id)).rejects.toEqual(
      expect.objectContaining({
        name: "ServiceAvailabilityEvaluationError",
        code: "invalid_service_availability_instant",
      }),
    );
    expect(store.findByServiceId).toHaveBeenCalledOnce();
    expect(statusReader.read).toHaveBeenCalledOnce();
    expect(clock.now).toHaveBeenCalledOnce();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.removeByServiceId).not.toHaveBeenCalled();
  });

  it.each([
    [["readStatus"], "stopped", { kind: "execute", operation: "start" }],
    [["readStatus"], "running", { kind: "execute", operation: "stop" }],
    [
      ["readStatus", "start"],
      "running",
      { kind: "execute", operation: "stop" },
    ],
    [
      ["readStatus", "stop"],
      "stopped",
      { kind: "execute", operation: "start" },
    ],
  ] as const)(
    "does not enforce supported operations %#",
    async (supportedOperations, runtimeState, expected) => {
      const policy =
        runtimeState === "stopped"
          ? policiesByExpectation.available
          : policiesByExpectation.unavailable;
      const service = createService(policy, { supportedOperations });
      const { useCase } = createUseCase(service, runtimeState);

      await expect(useCase.execute(service.id)).resolves.toEqual(expected);
    },
  );

  it("does not mutate inputs or use an implicit clock", async () => {
    const dateNow = vi.spyOn(Date, "now");
    const instant = new Date(reconciliationTimestamp);
    const service = createService(policiesByExpectation.available);
    const originalPolicy = service.availabilityPolicy;
    const originalOperations = service.supportedOperations;
    const originalTimestamp = instant.getTime();
    const { useCase, store } = createUseCase(service, "stopped", null, instant);

    const decision = await useCase.execute(service.id);

    expect(decision).toEqual({ kind: "execute", operation: "start" });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Date.now).not.toHaveBeenCalled();
    expect(instant.getTime()).toBe(originalTimestamp);
    expect(service.availabilityPolicy).toBe(originalPolicy);
    expect(service.supportedOperations).toBe(originalOperations);
    expect(Object.isFrozen(service)).toBe(true);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.removeByServiceId).not.toHaveBeenCalled();

    dateNow.mockRestore();
  });
});
