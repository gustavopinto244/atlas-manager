import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "../../../src/service-management/application/ports/service-availability-override-store.js";
import { SetRegisteredServiceAvailabilityOverride } from "../../../src/service-management/application/set-registered-service-availability-override.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { InMemoryServiceAvailabilityOverrideStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-override-store.js";

const referenceTimestamp = "2026-08-05T12:00:00.000Z";
const expirationTimestamp = "2026-08-05T13:00:00.000Z";

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
      .mockResolvedValue(null),
    save: vi.fn<ServiceAvailabilityOverrideStore["save"]>().mockResolvedValue(),
    removeByServiceId: vi
      .fn<ServiceAvailabilityOverrideStore["removeByServiceId"]>()
      .mockResolvedValue(),
    removeByServiceIdIfMatches: vi
      .fn<ServiceAvailabilityOverrideStore["removeByServiceIdIfMatches"]>()
      .mockResolvedValue(Object.freeze({ kind: "not_removed" })),
  };
}

function createClock(reference = new Date(referenceTimestamp)): Clock & {
  readonly now: ReturnType<typeof vi.fn<Clock["now"]>>;
} {
  return { now: vi.fn<Clock["now"]>().mockReturnValue(reference) };
}

describe("SetRegisteredServiceAvailabilityOverride", () => {
  it.each(["keep_available", "suspend_schedule"] as const)(
    "creates, saves, and returns the exact canonical %s override",
    async (kind) => {
      const requestedId = "requested-service";
      const service = createService();
      const findById = vi.fn().mockResolvedValue(service);
      const store = createStore();
      const clock = createClock();
      const useCase = new SetRegisteredServiceAvailabilityOverride(
        createCatalog(findById),
        store,
        clock,
      );

      const result = await useCase.execute(requestedId, {
        kind,
        expiresAt: expirationTimestamp,
      });

      expect(findById).toHaveBeenCalledExactlyOnceWith(requestedId);
      expect(clock.now).toHaveBeenCalledOnce();
      expect(store.save).toHaveBeenCalledOnce();
      expect(store.save).toHaveBeenCalledWith(service.id, result);
      expect(store.save.mock.calls[0]?.[1]).toBe(result);
      expect(result).toEqual({ kind, expiresAt: expirationTimestamp });
      expect(Object.isFrozen(result)).toBe(true);
      expect(store.findByServiceId).not.toHaveBeenCalled();
      expect(store.removeByServiceId).not.toHaveBeenCalled();
    },
  );

  it("uses exact requested lookup input and the catalog-owned ID as store key", async () => {
    const requestedId = " Requested-Service ";
    const service = createService("catalog-owned-service");
    const findById = vi.fn().mockResolvedValue(service);
    const store = createStore();
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(findById),
      store,
      createClock(),
    );

    const result = await useCase.execute(requestedId, {
      kind: "keep_available",
      expiresAt: expirationTimestamp,
    });

    expect(findById).toHaveBeenCalledExactlyOnceWith(requestedId);
    expect(store.save).toHaveBeenCalledExactlyOnceWith(service.id, result);
    expect(service.id).not.toBe(requestedId);
    expect(store.save).not.toHaveBeenCalledWith(service.displayName, result);
    expect(store.save).not.toHaveBeenCalledWith(
      service.externalResourceId,
      result,
    );
  });

  it("waits for successful storage before returning", async () => {
    const service = createService();
    const store = createStore();
    let resolveSave: (() => void) | undefined;
    store.save.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      createClock(),
    );
    let returned = false;
    const execution = useCase
      .execute(service.id, {
        kind: "keep_available",
        expiresAt: expirationTimestamp,
      })
      .then((override) => {
        returned = true;
        return override;
      });

    await Promise.resolve();
    await Promise.resolve();

    expect(store.save).toHaveBeenCalledOnce();
    expect(returned).toBe(false);

    resolveSave?.();
    const result = await execution;

    expect(returned).toBe(true);
    expect(store.save.mock.calls[0]?.[1]).toBe(result);
  });

  it("rejects an unknown service before clock or store access", async () => {
    const requestedId = "sentinel-private-service";
    const findById = vi.fn().mockResolvedValue(null);
    const store = createStore();
    const clock = createClock();
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(findById),
      store,
      clock,
    );

    await expect(
      useCase.execute(requestedId, {
        kind: "keep_available",
        expiresAt: expirationTimestamp,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "RegisteredServiceNotFoundError",
        code: "registered_service_not_found",
      }),
    );
    expect(findById).toHaveBeenCalledExactlyOnceWith(requestedId);
    expect(clock.now).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(store.removeByServiceId).not.toHaveBeenCalled();
  });

  it("propagates catalog failure by identity before clock or store access", async () => {
    const catalogFailure = new Error("sentinel-catalog-failure");
    const store = createStore();
    const clock = createClock();
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockRejectedValue(catalogFailure)),
      store,
      clock,
    );

    await expect(
      useCase.execute("example-service", {
        kind: "keep_available",
        expiresAt: expirationTimestamp,
      }),
    ).rejects.toBe(catalogFailure);
    expect(clock.now).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "invalid_service_availability_override"],
    [null, "invalid_service_availability_override"],
    ["keep_available", "invalid_service_availability_override"],
    [[], "invalid_service_availability_override"],
    [{ kind: "keep_available" }, "invalid_service_availability_override"],
    [
      {
        kind: "unknown",
        expiresAt: expirationTimestamp,
      },
      "invalid_service_availability_override_kind",
    ],
    [
      {
        kind: "KEEP_AVAILABLE",
        expiresAt: expirationTimestamp,
      },
      "invalid_service_availability_override_kind",
    ],
    [
      {
        kind: "keep_available",
        expiresAt: "2026-08-05T13:00:00Z",
      },
      "invalid_service_availability_override_expiration",
    ],
    [
      {
        kind: "keep_available",
        expiresAt: "2026-08-05T13:00:00.000-03:00",
      },
      "invalid_service_availability_override_expiration",
    ],
    [
      {
        kind: "keep_available",
        expiresAt: referenceTimestamp,
      },
      "non_future_service_availability_override_expiration",
    ],
    [
      {
        kind: "keep_available",
        expiresAt: "2026-08-05T11:59:59.999Z",
      },
      "non_future_service_availability_override_expiration",
    ],
  ] as const)(
    "preserves domain validation code %s",
    async (overrideInput, code) => {
      const service = createService();
      const store = createStore();
      const clock = createClock();
      const useCase = new SetRegisteredServiceAvailabilityOverride(
        createCatalog(vi.fn().mockResolvedValue(service)),
        store,
        clock,
      );

      await expect(useCase.execute(service.id, overrideInput)).rejects.toEqual(
        expect.objectContaining({
          name: "ServiceAvailabilityOverrideValidationError",
          code,
        }),
      );
      expect(clock.now).toHaveBeenCalledOnce();
      expect(store.save).not.toHaveBeenCalled();
      expect(store.removeByServiceId).not.toHaveBeenCalled();
    },
  );

  it("propagates invalid clock result through the domain factory", async () => {
    const service = createService();
    const store = createStore();
    const clock = createClock(new Date(Number.NaN));
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      clock,
    );
    const dateNowSpy = vi.spyOn(Date, "now");

    try {
      await expect(
        useCase.execute(service.id, {
          kind: "keep_available",
          expiresAt: expirationTimestamp,
        }),
      ).rejects.toEqual(
        expect.objectContaining({
          name: "ServiceAvailabilityOverrideValidationError",
          code: "invalid_service_availability_override_reference_instant",
        }),
      );
      expect(clock.now).toHaveBeenCalledOnce();
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("uses the exact clock Date once without mutating it", async () => {
    let getTimeCalls = 0;

    class ObservableDate extends Date {
      public override getTime(): number {
        getTimeCalls += 1;
        return super.getTime();
      }
    }

    const reference = new ObservableDate(referenceTimestamp);
    const originalTimestamp = Date.prototype.getTime.call(reference);
    const service = createService();
    const store = createStore();
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      createClock(reference),
    );

    await useCase.execute(service.id, {
      kind: "keep_available",
      expiresAt: expirationTimestamp,
    });

    expect(getTimeCalls).toBe(1);
    expect(Date.prototype.getTime.call(reference)).toBe(originalTimestamp);
  });

  it("follows lookup, clock, and save order", async () => {
    const trace: string[] = [];
    const service = createService();
    const catalog = createCatalog(
      vi.fn(() => {
        trace.push("catalog lookup");
        return Promise.resolve(service);
      }),
    );
    const clock: Clock = {
      now: vi.fn(() => {
        trace.push("clock read");
        return new Date(referenceTimestamp);
      }),
    };
    const store = createStore();
    store.save.mockImplementation(() => {
      trace.push("store save");
      return Promise.resolve();
    });
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      catalog,
      store,
      clock,
    );

    await useCase.execute(service.id, {
      kind: "keep_available",
      expiresAt: expirationTimestamp,
    });

    expect(trace).toEqual(["catalog lookup", "clock read", "store save"]);
  });

  it("propagates store failure by identity without retry or fallback access", async () => {
    const service = createService();
    const storeFailure = new Error("sentinel-store-failure");
    const store = createStore();
    store.save.mockRejectedValue(storeFailure);
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      createClock(),
    );

    await expect(
      useCase.execute(service.id, {
        kind: "keep_available",
        expiresAt: expirationTimestamp,
      }),
    ).rejects.toBe(storeFailure);
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.findByServiceId).not.toHaveBeenCalled();
    expect(store.removeByServiceId).not.toHaveBeenCalled();
  });

  it("replaces through the existing in-memory store save semantics", async () => {
    const service = createService();
    const store = new InMemoryServiceAvailabilityOverrideStore();
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      createClock(),
    );

    const firstOverride = await useCase.execute(service.id, {
      kind: "keep_available",
      expiresAt: "2026-08-05T14:00:00.000Z",
    });
    const secondOverride = await useCase.execute(service.id, {
      kind: "suspend_schedule",
      expiresAt: "2026-08-05T12:30:00.000Z",
    });

    expect(firstOverride).not.toBe(secondOverride);
    await expect(store.findByServiceId(service.id)).resolves.toBe(
      secondOverride,
    );
  });

  it("isolates catalog-owned services in the existing store", async () => {
    const firstService = createService("first-service");
    const secondService = createService("second-service");
    const catalog = createCatalog(
      vi.fn((serviceId) =>
        Promise.resolve(
          serviceId === firstService.id ? firstService : secondService,
        ),
      ),
    );
    const store = new InMemoryServiceAvailabilityOverrideStore();
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      catalog,
      store,
      createClock(),
    );

    const firstOverride = await useCase.execute(firstService.id, {
      kind: "keep_available",
      expiresAt: expirationTimestamp,
    });
    const secondOverride = await useCase.execute(secondService.id, {
      kind: "keep_available",
      expiresAt: expirationTimestamp,
    });

    await expect(store.findByServiceId(firstService.id)).resolves.toBe(
      firstOverride,
    );
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
      const useCase = new SetRegisteredServiceAvailabilityOverride(
        createCatalog(vi.fn().mockResolvedValue(service)),
        store,
        createClock(),
      );

      const result = await useCase.execute(service.id, {
        kind: "keep_available",
        expiresAt: expirationTimestamp,
      });

      expect(store.save).toHaveBeenCalledWith(service.id, result);
    },
  );

  it("does not retain mutable raw input or mutate the service and clock Date", async () => {
    const service = createService();
    const originalService = structuredClone(service);
    const reference = new Date(referenceTimestamp);
    const originalReferenceTimestamp = reference.getTime();
    const overrideInput = {
      kind: "keep_available",
      expiresAt: expirationTimestamp,
    };
    const store = createStore();
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      store,
      createClock(reference),
    );
    const result = await useCase.execute(service.id, overrideInput);

    overrideInput.kind = "suspend_schedule";
    overrideInput.expiresAt = "2027-01-01T00:00:00.000Z";
    Reflect.set(overrideInput, "serviceId", "sentinel-private-service");

    expect(result).toEqual({
      kind: "keep_available",
      expiresAt: expirationTimestamp,
    });
    expect(store.save.mock.calls[0]?.[1]).toBe(result);
    expect(service).toEqual(originalService);
    expect(reference.getTime()).toBe(originalReferenceTimestamp);
  });

  it("uses no implicit clock, timer, or process listener", async () => {
    const service = createService();
    const useCase = new SetRegisteredServiceAvailabilityOverride(
      createCatalog(vi.fn().mockResolvedValue(service)),
      createStore(),
      createClock(),
    );
    const dateNowSpy = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      await useCase.execute(service.id, {
        kind: "keep_available",
        expiresAt: expirationTimestamp,
      });

      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
