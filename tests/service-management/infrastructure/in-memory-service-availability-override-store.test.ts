import { describe, expect, it, vi } from "vitest";

import type { ServiceAvailabilityOverrideStore } from "../../../src/service-management/application/ports/service-availability-override-store.js";
import { InMemoryServiceAvailabilityOverrideStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-override-store.js";
import {
  createServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../../src/service-scheduling/domain/service-availability-override.js";

const creationInstant = new Date("2026-08-01T10:00:00.000Z");

function createOverride(
  kind: "keep_available" | "suspend_schedule",
  expiresAt = "2026-08-01T12:00:00.000Z",
): ServiceAvailabilityOverride {
  return createServiceAvailabilityOverride(
    { kind, expiresAt },
    creationInstant,
  );
}

function createStore(): ServiceAvailabilityOverrideStore {
  return new InMemoryServiceAvailabilityOverrideStore();
}

describe("InMemoryServiceAvailabilityOverrideStore", () => {
  it("starts empty and treats repeated missing removal as success", async () => {
    const store = createStore();

    await expect(store.findByServiceId("example-service")).resolves.toBeNull();
    await expect(
      store.removeByServiceId("example-service"),
    ).resolves.toBeUndefined();
    await expect(
      store.removeByServiceId("example-service"),
    ).resolves.toBeUndefined();
    await expect(store.findByServiceId("example-service")).resolves.toBeNull();
  });

  it.each(["keep_available", "suspend_schedule"] as const)(
    "stores and repeatedly returns the exact %s override instance",
    async (kind) => {
      const store = createStore();
      const override = createOverride(kind);

      await store.save("example-service", override);

      await expect(store.findByServiceId("example-service")).resolves.toBe(
        override,
      );
      await expect(store.findByServiceId("example-service")).resolves.toBe(
        override,
      );
      expect(Object.isFrozen(override)).toBe(true);
    },
  );

  it("replaces an existing association with only the latest override", async () => {
    const store = createStore();
    const firstOverride = createOverride(
      "keep_available",
      "2026-08-03T12:00:00.000Z",
    );
    const secondOverride = createOverride(
      "suspend_schedule",
      "2026-08-01T11:00:00.000Z",
    );

    await store.save("example-service", firstOverride);
    await store.save("example-service", secondOverride);

    await expect(store.findByServiceId("example-service")).resolves.toBe(
      secondOverride,
    );
    await expect(store.findByServiceId("example-service")).resolves.not.toBe(
      firstOverride,
    );
  });

  it("isolates save, replacement, and removal between services", async () => {
    const store = createStore();
    const firstOverride = createOverride("keep_available");
    const replacement = createOverride(
      "suspend_schedule",
      "2026-08-02T12:00:00.000Z",
    );
    const secondOverride = createOverride("suspend_schedule");

    await store.save("service-a", firstOverride);
    await store.save("service-b", secondOverride);
    await store.save("service-a", replacement);

    await expect(store.findByServiceId("service-a")).resolves.toBe(replacement);
    await expect(store.findByServiceId("service-b")).resolves.toBe(
      secondOverride,
    );

    await store.removeByServiceId("service-a");

    await expect(store.findByServiceId("service-a")).resolves.toBeNull();
    await expect(store.findByServiceId("service-b")).resolves.toBe(
      secondOverride,
    );
  });

  it("allows equal values and the same instance under different keys", async () => {
    const store = createStore();
    const firstEqualOverride = createOverride("keep_available");
    const secondEqualOverride = createOverride("keep_available");
    const sharedOverride = createOverride("suspend_schedule");

    await store.save("first-equal-service", firstEqualOverride);
    await store.save("second-equal-service", secondEqualOverride);
    await store.save("first-shared-service", sharedOverride);
    await store.save("second-shared-service", sharedOverride);

    await expect(store.findByServiceId("first-equal-service")).resolves.toBe(
      firstEqualOverride,
    );
    await expect(store.findByServiceId("second-equal-service")).resolves.toBe(
      secondEqualOverride,
    );
    await expect(store.findByServiceId("first-shared-service")).resolves.toBe(
      sharedOverride,
    );
    await expect(store.findByServiceId("second-shared-service")).resolves.toBe(
      sharedOverride,
    );
  });

  it.each([
    "example-service",
    "Example-Service",
    "example-service ",
    " example-service",
  ])(
    "uses the exact identifier as an independent key: %j",
    async (serviceId) => {
      const store = createStore();
      const override = createOverride("keep_available");

      await store.save(serviceId, override);

      for (const otherId of [
        "example-service",
        "Example-Service",
        "example-service ",
        " example-service",
      ]) {
        await expect(store.findByServiceId(otherId)).resolves.toBe(
          otherId === serviceId ? override : null,
        );
      }
    },
  );

  it("removes only the exact association without mutating its override", async () => {
    const store = createStore();
    const override = createOverride("keep_available");
    const originalOverride = structuredClone(override);

    await store.save("example-service", override);
    await expect(
      store.removeByServiceId("example-service"),
    ).resolves.toBeUndefined();

    await expect(store.findByServiceId("example-service")).resolves.toBeNull();
    expect(override).toEqual(originalOverride);
    expect(Object.isFrozen(override)).toBe(true);
  });

  it("keeps an expired canonical override until explicit removal", async () => {
    const store = createStore();
    const override = createOverride(
      "keep_available",
      "2026-08-01T11:00:00.000Z",
    );

    await store.save("expired-service", override);
    await store.save("other-service", createOverride("suspend_schedule"));
    await store.removeByServiceId("other-service");

    await expect(store.findByServiceId("expired-service")).resolves.toBe(
      override,
    );
  });

  it("returns frozen not_removed for an absent conditional removal", async () => {
    const store = createStore();
    const expectedOverride = createOverride("keep_available");

    const result = await store.removeByServiceIdIfMatches(
      "example-service",
      expectedOverride,
    );

    expect(result).toEqual({ kind: "not_removed" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual(["kind"]);
    await expect(store.findByServiceId("example-service")).resolves.toBeNull();
  });

  it("conditionally removes a separately constructed value-equal override", async () => {
    const store = createStore();
    const storedOverride = createOverride("keep_available");
    const expectedOverride = createOverride("keep_available");
    await store.save("example-service", storedOverride);

    const result = await store.removeByServiceIdIfMatches(
      "example-service",
      expectedOverride,
    );

    expect(storedOverride).not.toBe(expectedOverride);
    expect(result).toEqual({ kind: "removed" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual(["kind"]);
    await expect(store.findByServiceId("example-service")).resolves.toBeNull();
  });

  it.each([
    ["kind", createOverride("suspend_schedule")],
    [
      "expiration",
      createOverride("keep_available", "2026-08-01T13:00:00.000Z"),
    ],
  ])(
    "does not conditionally remove an override with a different %s",
    async (_difference, expectedOverride) => {
      const store = createStore();
      const storedOverride = createOverride("keep_available");
      await store.save("example-service", storedOverride);

      const result = await store.removeByServiceIdIfMatches(
        "example-service",
        expectedOverride,
      );

      expect(result).toEqual({ kind: "not_removed" });
      expect(Object.isFrozen(result)).toBe(true);
      await expect(store.findByServiceId("example-service")).resolves.toBe(
        storedOverride,
      );
    },
  );

  it("conditionally removes only the matching service association", async () => {
    const store = createStore();
    const firstOverride = createOverride("keep_available");
    const secondOverride = createOverride("suspend_schedule");
    await store.save("service-a", firstOverride);
    await store.save("service-b", secondOverride);

    await expect(
      store.removeByServiceIdIfMatches(
        "service-a",
        createOverride("keep_available"),
      ),
    ).resolves.toEqual({ kind: "removed" });

    await expect(store.findByServiceId("service-a")).resolves.toBeNull();
    await expect(store.findByServiceId("service-b")).resolves.toBe(
      secondOverride,
    );
  });

  it("keeps separate store instances isolated", async () => {
    const firstStore = createStore();
    const secondStore = createStore();
    const firstOverride = createOverride("keep_available");
    const replacement = createOverride("suspend_schedule");

    await expect(
      firstStore.findByServiceId("example-service"),
    ).resolves.toBeNull();
    await expect(
      secondStore.findByServiceId("example-service"),
    ).resolves.toBeNull();

    await firstStore.save("example-service", firstOverride);
    await firstStore.save("example-service", replacement);

    await expect(firstStore.findByServiceId("example-service")).resolves.toBe(
      replacement,
    );
    await expect(
      secondStore.findByServiceId("example-service"),
    ).resolves.toBeNull();

    await firstStore.removeByServiceId("example-service");

    await expect(
      secondStore.findByServiceId("example-service"),
    ).resolves.toBeNull();
  });

  it("exposes only the approved operations and no mutable collection API", () => {
    const store = new InMemoryServiceAvailabilityOverrideStore();
    const prototypeMethods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(store) as object,
    ).sort();

    expect(Object.keys(store)).toEqual([]);
    expect(prototypeMethods).toEqual(
      [
        "constructor",
        "findByServiceId",
        "removeByServiceId",
        "removeByServiceIdIfMatches",
        "save",
      ].sort(),
    );
    expect(store).not.toHaveProperty("overrides");
    expect(store).not.toHaveProperty("map");
    expect(store).not.toHaveProperty("list");
    expect(store).not.toHaveProperty("listAll");
    expect(store).not.toHaveProperty("entries");
    expect(store).not.toHaveProperty("snapshot");
    expect(Object.isFrozen(store)).toBe(true);

    expect(() => {
      (store as unknown as { overrides: Map<string, unknown> }).overrides =
        new Map();
    }).toThrow(TypeError);
  });

  it("performs no time or process side effects during operations", async () => {
    const store = createStore();
    const override = createOverride("keep_available");
    const expectedOverride = createOverride("keep_available");
    const dateSpy = vi.spyOn(globalThis, "Date");
    const dateNowSpy = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      await store.save("example-service", override);
      await store.findByServiceId("example-service");
      await store.removeByServiceId("example-service");
      await store.removeByServiceIdIfMatches(
        "example-service",
        expectedOverride,
      );

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
