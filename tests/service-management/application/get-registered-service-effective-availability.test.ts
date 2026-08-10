import { describe, expect, it, vi } from "vitest";

import { GetRegisteredServiceEffectiveAvailability } from "../../../src/service-management/application/get-registered-service-effective-availability.js";
import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "../../../src/service-management/application/ports/service-availability-override-store.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  createServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../../src/service-scheduling/domain/service-availability-override.js";

const evaluationTimestamp = "2026-08-03T13:00:00.000Z";

function createService(
  availabilityPolicy: unknown = { mode: "manual" },
  id = "catalog-owned-service",
  supportedOperations: readonly string[] = ["readStatus"],
): RegisteredService {
  return RegisteredService.create({
    id,
    displayName: "Catalog Owned Service",
    managementAdapter: "mock",
    externalResourceId: "private-infrastructure-target",
    supportedOperations,
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

function createClock(instant = new Date(evaluationTimestamp)): Clock & {
  readonly now: ReturnType<typeof vi.fn<Clock["now"]>>;
} {
  return {
    now: vi.fn<Clock["now"]>().mockReturnValue(instant),
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

function createUseCase(
  service: RegisteredService,
  override: ServiceAvailabilityOverride | null,
  instant = new Date(evaluationTimestamp),
): {
  readonly useCase: GetRegisteredServiceEffectiveAvailability;
  readonly findById: ReturnType<typeof vi.fn>;
  readonly store: ReturnType<typeof createStore>;
  readonly clock: ReturnType<typeof createClock>;
} {
  const findById = vi.fn().mockResolvedValue(service);
  const store = createStore(override);
  const clock = createClock(instant);

  return {
    useCase: new GetRegisteredServiceEffectiveAvailability(
      createCatalog(findById),
      store,
      clock,
    ),
    findById,
    store,
    clock,
  };
}

describe("GetRegisteredServiceEffectiveAvailability", () => {
  it.each([
    ["always", { mode: "always" }, "available"],
    ["manual", { mode: "manual" }, "manual"],
    ["disabled", { mode: "disabled" }, "disabled"],
  ] as const)(
    "returns the base %s expectation when no override is stored",
    async (_mode, policy, expected) => {
      const service = createService(policy);
      const { useCase, store, clock } = createUseCase(service, null);

      const result = await useCase.execute(service.id);

      expect(result).toBe(expected);
      expect(typeof result).toBe("string");
      expect(store.findByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
      expect(clock.now).toHaveBeenCalledOnce();
      expect(store.save).not.toHaveBeenCalled();
      expect(store.removeByServiceId).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["inside", "2026-08-03T13:00:00.000Z", "available"],
    ["outside", "2026-08-03T12:59:59.999Z", "unavailable"],
    ["exclusive end", "2026-08-03T14:00:00.000Z", "unavailable"],
  ] as const)(
    "preserves scheduled evaluation %s a window",
    async (_case, instant, expected) => {
      const service = createService({
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "10:00", end: "11:00" }],
      });
      const { useCase } = createUseCase(service, null, new Date(instant));

      await expect(useCase.execute(service.id)).resolves.toBe(expected);
    },
  );

  it.each([
    ["always", { mode: "always" }, "available"],
    [
      "scheduled",
      {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "11:00", end: "12:00" }],
      },
      "available",
    ],
    ["manual", { mode: "manual" }, "available"],
    ["disabled", { mode: "disabled" }, "disabled"],
  ] as const)(
    "preserves active keep_available behavior for %s",
    async (_mode, policy, expected) => {
      const service = createService(policy);
      const override = createOverride("keep_available");
      const { useCase, store } = createUseCase(service, override);

      await expect(useCase.execute(service.id)).resolves.toBe(expected);
      await expect(store.findByServiceId(service.id)).resolves.toBe(override);
      expect(store.save).not.toHaveBeenCalled();
      expect(store.removeByServiceId).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["always", { mode: "always" }, "manual"],
    [
      "scheduled",
      {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "10:00", end: "11:00" }],
      },
      "manual",
    ],
    ["manual", { mode: "manual" }, "manual"],
    ["disabled", { mode: "disabled" }, "disabled"],
  ] as const)(
    "preserves active suspend_schedule behavior for %s",
    async (_mode, policy, expected) => {
      const service = createService(policy);
      const override = createOverride("suspend_schedule");
      const { useCase } = createUseCase(service, override);

      await expect(useCase.execute(service.id)).resolves.toBe(expected);
    },
  );

  it.each([
    ["keep_available", "2026-08-03T13:00:00.000Z"],
    ["keep_available", "2026-08-03T12:59:59.999Z"],
    ["suspend_schedule", "2026-08-02T13:00:00.000Z"],
  ] as const)(
    "passes an expired %s override through without cleanup",
    async (kind, expiresAt) => {
      const service = createService({ mode: "always" });
      const override = createOverride(kind, expiresAt);
      const { useCase, store } = createUseCase(service, override);

      await expect(useCase.execute(service.id)).resolves.toBe("available");
      expect(store.findByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
      expect(store.save).not.toHaveBeenCalled();
      expect(store.removeByServiceId).not.toHaveBeenCalled();
      expect(override.expiresAt).toBe(expiresAt);
    },
  );

  it("uses the requested ID unchanged for lookup and the catalog-owned ID for storage", async () => {
    const requestedId = " Requested-Service ";
    const service = createService();
    const { useCase, findById, store } = createUseCase(service, null);

    await useCase.execute(requestedId);

    expect(findById).toHaveBeenCalledExactlyOnceWith(requestedId);
    expect(store.findByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
    expect(store.findByServiceId).not.toHaveBeenCalledWith(requestedId);
    expect(store.findByServiceId).not.toHaveBeenCalledWith(service.displayName);
    expect(store.findByServiceId).not.toHaveBeenCalledWith(
      service.externalResourceId,
    );
  });

  it("rejects an unknown service before store or clock access", async () => {
    const findById = vi.fn().mockResolvedValue(null);
    const store = createStore(null);
    const clock = createClock();
    const useCase = new GetRegisteredServiceEffectiveAvailability(
      createCatalog(findById),
      store,
      clock,
    );

    await expect(useCase.execute("unknown-service")).rejects.toEqual(
      expect.objectContaining({
        name: "RegisteredServiceNotFoundError",
        code: "registered_service_not_found",
        message: "Registered service not found",
      }),
    );
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("propagates catalog failure by identity", async () => {
    const failure = new Error("sentinel-catalog-failure");
    const store = createStore(null);
    const clock = createClock();
    const useCase = new GetRegisteredServiceEffectiveAvailability(
      createCatalog(vi.fn().mockRejectedValue(failure)),
      store,
      clock,
    );

    await expect(useCase.execute("example-service")).rejects.toBe(failure);
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("propagates store failure before reading the clock", async () => {
    const service = createService();
    const failure = new Error("sentinel-store-failure");
    const store = createStore(null);
    store.findByServiceId.mockRejectedValue(failure);
    const clock = createClock();
    const useCase = new GetRegisteredServiceEffectiveAvailability(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      clock,
    );

    await expect(useCase.execute(service.id)).rejects.toBe(failure);
    expect(store.findByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
    expect(clock.now).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.removeByServiceId).not.toHaveBeenCalled();
  });

  it("propagates clock failure after store lookup", async () => {
    const service = createService();
    const failure = new Error("sentinel-clock-failure");
    const store = createStore(null);
    const now = vi.fn<Clock["now"]>(() => {
      throw failure;
    });
    const useCase = new GetRegisteredServiceEffectiveAvailability(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      { now },
    );

    await expect(useCase.execute(service.id)).rejects.toBe(failure);
    expect(store.findByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
    expect(now).toHaveBeenCalledOnce();
  });

  it("preserves invalid-instant evaluator errors", async () => {
    const service = createService();
    const { useCase, clock, store } = createUseCase(
      service,
      null,
      new Date(Number.NaN),
    );

    await expect(useCase.execute(service.id)).rejects.toEqual(
      expect.objectContaining({
        name: "ServiceAvailabilityEvaluationError",
        code: "invalid_service_availability_instant",
        message: "Invalid service availability instant",
      }),
    );
    expect(clock.now).toHaveBeenCalledOnce();
    expect(store.findByServiceId).toHaveBeenCalledOnce();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.removeByServiceId).not.toHaveBeenCalled();
  });

  it("executeWithOverride surfaces the active override alongside the expectation", async () => {
    const service = createService({ mode: "always" });
    const override = createOverride("keep_available");
    const { useCase } = createUseCase(service, override);

    await expect(useCase.executeWithOverride(service.id)).resolves.toEqual({
      expectation: "available",
      override,
    });
  });

  it("executeWithOverride returns null for a service with no override", async () => {
    const service = createService({ mode: "manual" });
    const { useCase } = createUseCase(service, null);

    await expect(useCase.executeWithOverride(service.id)).resolves.toEqual({
      expectation: "manual",
      override: null,
    });
  });

  it("executeWithOverride returns null for an expired override", async () => {
    const service = createService({ mode: "always" });
    const override = createOverride(
      "suspend_schedule",
      "2026-08-02T13:00:00.000Z",
    );
    const { useCase } = createUseCase(service, override);

    await expect(useCase.executeWithOverride(service.id)).resolves.toEqual({
      expectation: "available",
      override: null,
    });
  });

  it("execute() still returns just the expectation string", async () => {
    const service = createService({ mode: "always" });
    const override = createOverride("keep_available");
    const { useCase } = createUseCase(service, override);

    await expect(useCase.execute(service.id)).resolves.toBe("available");
  });

  it("follows catalog, store, clock, and return order", async () => {
    const trace: string[] = [];
    const service = createService({ mode: "always" });
    const catalog = createCatalog(
      vi.fn(() => {
        trace.push("catalog");
        return Promise.resolve(service);
      }),
    );
    const store = createStore(null);
    store.findByServiceId.mockImplementation(() => {
      trace.push("store");
      return Promise.resolve(null);
    });
    const clock = createClock();
    clock.now.mockImplementation(() => {
      trace.push("clock");
      return new Date(evaluationTimestamp);
    });
    const useCase = new GetRegisteredServiceEffectiveAvailability(
      catalog,
      store,
      clock,
    );

    await useCase.execute(service.id);
    trace.push("return");

    expect(trace).toEqual(["catalog", "store", "clock", "return"]);
  });

  it("does not mutate domain inputs or acquire another current instant", async () => {
    const dateNow = vi.spyOn(Date, "now");
    const evaluationInstant = new Date(evaluationTimestamp);
    const service = createService({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: [{ weekday: "monday", start: "10:00", end: "11:00" }],
    });
    const override = createOverride("keep_available");
    const originalPolicy = service.availabilityPolicy;
    const originalTimestamp = evaluationInstant.getTime();
    const { useCase } = createUseCase(service, override, evaluationInstant);

    await useCase.execute(service.id);

    expect(Date.now).not.toHaveBeenCalled();
    expect(evaluationInstant.getTime()).toBe(originalTimestamp);
    expect(service.availabilityPolicy).toBe(originalPolicy);
    expect(Object.isFrozen(service)).toBe(true);
    expect(Object.isFrozen(service.availabilityPolicy)).toBe(true);
    expect(Object.isFrozen(override)).toBe(true);

    dateNow.mockRestore();
  });
});
