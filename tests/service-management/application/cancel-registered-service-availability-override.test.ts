import { describe, expect, it, vi } from "vitest";

import { CancelRegisteredServiceAvailabilityOverride } from "../../../src/service-management/application/cancel-registered-service-availability-override.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "../../../src/service-management/application/ports/service-availability-override-store.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { InMemoryServiceAvailabilityOverrideStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-override-store.js";
import { createServiceAvailabilityOverride } from "../../../src/service-scheduling/domain/service-availability-override.js";

function createService(
  id = "catalog-owned-service",
  availabilityPolicy: unknown = { mode: "manual" },
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

function createStore(): ServiceAvailabilityOverrideStore & {
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
      .mockRejectedValue(new Error("find must not be called")),
    save: vi
      .fn<ServiceAvailabilityOverrideStore["save"]>()
      .mockRejectedValue(new Error("save must not be called")),
    removeByServiceId: vi
      .fn<ServiceAvailabilityOverrideStore["removeByServiceId"]>()
      .mockResolvedValue(),
    removeByServiceIdIfMatches: vi
      .fn<ServiceAvailabilityOverrideStore["removeByServiceIdIfMatches"]>()
      .mockResolvedValue(Object.freeze({ kind: "not_removed" })),
  };
}

describe("CancelRegisteredServiceAvailabilityOverride", () => {
  it("removes by catalog-owned ID and resolves with no result", async () => {
    const requestedId = " Requested-Service ";
    const service = createService();
    const findById = vi.fn().mockResolvedValue(service);
    const store = createStore();
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(findById),
      store,
    );

    await expect(useCase.execute(requestedId)).resolves.toBeUndefined();

    expect(findById).toHaveBeenCalledExactlyOnceWith(requestedId);
    expect(store.removeByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
    expect(store.removeByServiceId).not.toHaveBeenCalledWith(requestedId);
    expect(store.removeByServiceId).not.toHaveBeenCalledWith(
      service.displayName,
    );
    expect(store.removeByServiceId).not.toHaveBeenCalledWith(
      service.externalResourceId,
    );
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("rejects an unknown service before any store access", async () => {
    const requestedId = "sentinel-private-service";
    const findById = vi.fn().mockResolvedValue(null);
    const store = createStore();
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(findById),
      store,
    );

    await expect(useCase.execute(requestedId)).rejects.toEqual(
      expect.objectContaining({
        name: "RegisteredServiceNotFoundError",
        code: "registered_service_not_found",
        message: "Registered service not found",
      }),
    );
    expect(findById).toHaveBeenCalledExactlyOnceWith(requestedId);
    expect(store.removeByServiceId).not.toHaveBeenCalled();
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("propagates catalog failure by identity before store access", async () => {
    const catalogFailure = new Error("sentinel-catalog-failure");
    const store = createStore();
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockRejectedValue(catalogFailure)),
      store,
    );

    await expect(useCase.execute("example-service")).rejects.toBe(
      catalogFailure,
    );
    expect(store.removeByServiceId).not.toHaveBeenCalled();
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("waits for removal before resolving", async () => {
    const service = createService();
    const store = createStore();
    let resolveRemoval: (() => void) | undefined;
    store.removeByServiceId.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemoval = resolve;
        }),
    );
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
    );
    let completed = false;
    const execution = useCase.execute(service.id).then(() => {
      completed = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(store.removeByServiceId).toHaveBeenCalledOnce();
    expect(completed).toBe(false);

    resolveRemoval?.();
    await execution;

    expect(completed).toBe(true);
  });

  it("propagates removal failure by identity without retry or fallback", async () => {
    const service = createService();
    const storeFailure = new Error("sentinel-removal-failure");
    const store = createStore();
    store.removeByServiceId.mockRejectedValue(storeFailure);
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
    );

    await expect(useCase.execute(service.id)).rejects.toBe(storeFailure);
    expect(store.removeByServiceId).toHaveBeenCalledExactlyOnceWith(service.id);
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("follows catalog lookup then store removal order", async () => {
    const trace: string[] = [];
    const service = createService();
    const catalog = createCatalog(
      vi.fn(() => {
        trace.push("catalog lookup");
        return Promise.resolve(service);
      }),
    );
    const store = createStore();
    store.removeByServiceId.mockImplementation(() => {
      trace.push("store removal");
      return Promise.resolve();
    });
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      catalog,
      store,
    );

    await useCase.execute(service.id);
    trace.push("successful return");

    expect(trace).toEqual([
      "catalog lookup",
      "store removal",
      "successful return",
    ]);
  });

  it("is idempotent for a known service through the in-memory store", async () => {
    const service = createService();
    const store = new InMemoryServiceAvailabilityOverrideStore();
    const override = createServiceAvailabilityOverride(
      {
        kind: "keep_available",
        expiresAt: "2026-08-06T13:00:00.000Z",
      },
      new Date("2026-08-06T12:00:00.000Z"),
    );
    await store.save(service.id, override);
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
    );

    await expect(useCase.execute(service.id)).resolves.toBeUndefined();
    await expect(store.findByServiceId(service.id)).resolves.toBeNull();
    await expect(useCase.execute(service.id)).resolves.toBeUndefined();
    await expect(store.findByServiceId(service.id)).resolves.toBeNull();
    expect(override).toEqual({
      kind: "keep_available",
      expiresAt: "2026-08-06T13:00:00.000Z",
    });
  });

  it("removes only the selected service association", async () => {
    const firstService = createService("first-service");
    const secondService = createService("second-service");
    const firstOverride = createServiceAvailabilityOverride(
      {
        kind: "keep_available",
        expiresAt: "2026-08-06T13:00:00.000Z",
      },
      new Date("2026-08-06T12:00:00.000Z"),
    );
    const secondOverride = createServiceAvailabilityOverride(
      {
        kind: "suspend_schedule",
        expiresAt: "2026-08-06T14:00:00.000Z",
      },
      new Date("2026-08-06T12:00:00.000Z"),
    );
    const store = new InMemoryServiceAvailabilityOverrideStore();
    await store.save(firstService.id, firstOverride);
    await store.save(secondService.id, secondOverride);
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(firstService)),
      store,
    );

    await useCase.execute(firstService.id);

    await expect(store.findByServiceId(firstService.id)).resolves.toBeNull();
    await expect(store.findByServiceId(secondService.id)).resolves.toBe(
      secondOverride,
    );
  });

  it.each([
    ["always", { mode: "always" }],
    ["manual", { mode: "manual" }],
    ["disabled", { mode: "disabled" }],
    [
      "scheduled",
      {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
    ],
  ] as const)(
    "does not apply compatibility rules for %s policy",
    async (_label, availabilityPolicy) => {
      const service = createService("example-service", availabilityPolicy, [
        "readStatus",
      ]);
      const store = createStore();
      const useCase = new CancelRegisteredServiceAvailabilityOverride(
        createCatalog(vi.fn().mockResolvedValue(service)),
        store,
      );

      await expect(useCase.execute(service.id)).resolves.toBeUndefined();
      expect(store.removeByServiceId).toHaveBeenCalledWith(service.id);
    },
  );

  it.each([
    ["read only", ["readStatus"]],
    ["full control", ["readStatus", "start", "stop", "restart"]],
  ] as const)(
    "does not require service operations for %s",
    async (_label, supportedOperations) => {
      const service = createService(
        "example-service",
        { mode: "manual" },
        supportedOperations,
      );
      const store = createStore();
      const useCase = new CancelRegisteredServiceAvailabilityOverride(
        createCatalog(vi.fn().mockResolvedValue(service)),
        store,
      );

      await expect(useCase.execute(service.id)).resolves.toBeUndefined();
      expect(store.removeByServiceId).toHaveBeenCalledWith(service.id);
    },
  );

  it("does not mutate the registered service or stored override", async () => {
    const service = createService();
    const originalService = structuredClone(service);
    const override = createServiceAvailabilityOverride(
      {
        kind: "suspend_schedule",
        expiresAt: "2026-08-06T13:00:00.000Z",
      },
      new Date("2026-08-06T12:00:00.000Z"),
    );
    const originalOverride = structuredClone(override);
    const store = new InMemoryServiceAvailabilityOverrideStore();
    await store.save(service.id, override);
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
    );

    await useCase.execute(service.id);

    expect(service).toEqual(originalService);
    expect(override).toEqual(originalOverride);
    expect(Object.isFrozen(service)).toBe(true);
    expect(Object.isFrozen(override)).toBe(true);
  });

  it("uses no clock, current Date, timer, or process listener", async () => {
    const service = createService();
    const useCase = new CancelRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      createStore(),
    );
    const dateSpy = vi.spyOn(globalThis, "Date");
    const dateNowSpy = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      await useCase.execute(service.id);

      expect(dateSpy).not.toHaveBeenCalled();
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
      dateNowSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
