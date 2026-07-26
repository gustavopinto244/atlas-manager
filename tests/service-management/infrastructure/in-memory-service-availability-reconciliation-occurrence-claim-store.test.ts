import { describe, expect, it, vi } from "vitest";

import type {
  ServiceAvailabilityReconciliationOccurrenceClaimPruningResult,
  ServiceAvailabilityReconciliationOccurrenceClaimResult,
  ServiceAvailabilityReconciliationOccurrenceClaimStore,
} from "../../../src/service-management/application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import {
  ServiceAvailabilityReconciliationOccurrence,
  type CreateServiceAvailabilityReconciliationOccurrenceInput,
} from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import { InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-reconciliation-occurrence-claim-store.js";

const scheduledFor = "2026-07-27T11:00:00.000Z";

function createOccurrence(
  input: Partial<CreateServiceAvailabilityReconciliationOccurrenceInput> = {},
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId: "atlas-api",
    operation: "start",
    scheduledFor,
    ...input,
  });
}

function createStore(): ServiceAvailabilityReconciliationOccurrenceClaimStore {
  return new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
}

function expectCanonicalResult(
  result: ServiceAvailabilityReconciliationOccurrenceClaimResult,
  kind: "claimed" | "duplicate",
): void {
  expect(result).toEqual({ kind });
  expect(Object.keys(result)).toEqual(["kind"]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(() => {
    (
      result as {
        kind: "claimed" | "duplicate";
      }
    ).kind = kind === "claimed" ? "duplicate" : "claimed";
  }).toThrow(TypeError);
  expect(() => {
    Object.assign(result, { occurrence: "private" });
  }).toThrow(TypeError);
  expect(() => {
    delete (result as { kind?: "claimed" | "duplicate" }).kind;
  }).toThrow(TypeError);
}

function createCursor(
  completedThrough = "2026-07-27T11:00:00.000Z",
): ServiceAvailabilityReconciliationSchedulerCursor {
  return ServiceAvailabilityReconciliationSchedulerCursor.create({
    completedThrough,
  });
}

function expectCanonicalPruningResult(
  result: ServiceAvailabilityReconciliationOccurrenceClaimPruningResult,
  kind: "pruned" | "unchanged",
): void {
  expect(result).toEqual({ kind });
  expect(Object.keys(result)).toEqual(["kind"]);
  expect(Object.isFrozen(result)).toBe(true);
}

describe("InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore", () => {
  it("claims the first occurrence in an empty store", async () => {
    const store = createStore();

    const result = await store.claim(createOccurrence());

    expectCanonicalResult(result, "claimed");
  });

  it("returns duplicate for every repeated claim of the same object", async () => {
    const store = createStore();
    const occurrence = createOccurrence();

    expectCanonicalResult(await store.claim(occurrence), "claimed");
    expectCanonicalResult(await store.claim(occurrence), "duplicate");
    expectCanonicalResult(await store.claim(occurrence), "duplicate");
  });

  it("shares claim identity across independently constructed equivalent occurrences", async () => {
    const store = createStore();
    const first = createOccurrence();
    const equivalent = createOccurrence();

    expect(first).not.toBe(equivalent);
    await expect(store.claim(first)).resolves.toEqual({ kind: "claimed" });
    await expect(store.claim(equivalent)).resolves.toEqual({
      kind: "duplicate",
    });
  });

  it("isolates claims by exact service identifier", async () => {
    const store = createStore();
    const apiOccurrence = createOccurrence({ serviceId: "atlas-api" });
    const workerOccurrence = createOccurrence({ serviceId: "atlas-worker" });

    await expect(store.claim(apiOccurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(store.claim(workerOccurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(store.claim(createOccurrence())).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(
      store.claim(createOccurrence({ serviceId: "atlas-worker" })),
    ).resolves.toEqual({ kind: "duplicate" });
  });

  it("isolates start and stop claims at the same service instant", async () => {
    const store = createStore();
    const start = createOccurrence({ operation: "start" });
    const stop = createOccurrence({ operation: "stop" });

    await expect(store.claim(start)).resolves.toEqual({ kind: "claimed" });
    await expect(store.claim(stop)).resolves.toEqual({ kind: "claimed" });
    await expect(
      store.claim(createOccurrence({ operation: "start" })),
    ).resolves.toEqual({ kind: "duplicate" });
    await expect(
      store.claim(createOccurrence({ operation: "stop" })),
    ).resolves.toEqual({ kind: "duplicate" });
  });

  it("preserves millisecond precision between scheduled instants", async () => {
    const store = createStore();
    const first = createOccurrence({
      scheduledFor: "2026-07-27T11:00:00.000Z",
    });
    const nextMillisecond = createOccurrence({
      scheduledFor: "2026-07-27T11:00:00.001Z",
    });

    await expect(store.claim(first)).resolves.toEqual({ kind: "claimed" });
    await expect(store.claim(nextMillisecond)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(
      store.claim(
        createOccurrence({
          scheduledFor: "2026-07-27T11:00:00.001Z",
        }),
      ),
    ).resolves.toEqual({ kind: "duplicate" });
  });

  it.each([2, 10, 100])(
    "atomically permits exactly one of %i concurrent equivalent claims",
    async (claimCount) => {
      const store = createStore();
      const occurrences = Array.from({ length: claimCount }, () =>
        createOccurrence(),
      );

      const results = await Promise.all(
        occurrences.map((occurrence) => store.claim(occurrence)),
      );

      expect(results.filter(({ kind }) => kind === "claimed")).toHaveLength(1);
      expect(results.filter(({ kind }) => kind === "duplicate")).toHaveLength(
        claimCount - 1,
      );
      await expect(store.claim(createOccurrence())).resolves.toEqual({
        kind: "duplicate",
      });
    },
  );

  it("claims independent tuples concurrently without suppression", async () => {
    const store = createStore();
    const occurrences = [
      createOccurrence(),
      createOccurrence({ serviceId: "atlas-worker" }),
      createOccurrence({ operation: "stop" }),
      createOccurrence({
        scheduledFor: "2026-07-27T11:00:00.001Z",
      }),
    ];

    const results = await Promise.all(
      occurrences.map((occurrence) => store.claim(occurrence)),
    );

    expect(results).toEqual([
      { kind: "claimed" },
      { kind: "claimed" },
      { kind: "claimed" },
      { kind: "claimed" },
    ]);
  });

  it("does not mutate the occurrence or its source input", async () => {
    const source = {
      serviceId: "atlas-api",
      operation: "start",
      scheduledFor,
    };
    const sourceSnapshot = { ...source };
    const occurrence =
      ServiceAvailabilityReconciliationOccurrence.create(source);
    const occurrenceSnapshot = { ...occurrence };
    const store = createStore();

    await store.claim(occurrence);
    await store.claim(occurrence);

    expect(source).toEqual(sourceSnapshot);
    expect(occurrence).toEqual(occurrenceSnapshot);
    expect(Object.isFrozen(occurrence)).toBe(true);
    expect(occurrence).not.toHaveProperty("claimed");
    expect(occurrence).not.toHaveProperty("claimCount");
  });

  it("keeps claim state isolated between store instances", async () => {
    const firstStore = createStore();
    const secondStore = createStore();
    const occurrence = createOccurrence();

    await expect(firstStore.claim(occurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(secondStore.claim(occurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(firstStore.claim(occurrence)).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(secondStore.claim(occurrence)).resolves.toEqual({
      kind: "duplicate",
    });
  });

  it("returns frozen unchanged when pruning an empty store", async () => {
    const store = createStore();

    expectCanonicalPruningResult(
      await store.pruneCompletedThrough(createCursor()),
      "unchanged",
    );
    await expect(store.claim(createOccurrence())).resolves.toEqual({
      kind: "claimed",
    });
  });

  it("prunes claims before and at the inclusive cursor boundary while preserving future claims", async () => {
    const store = createStore();
    const before = createOccurrence({
      scheduledFor: "2026-07-27T10:59:00.000Z",
    });
    const exact = createOccurrence();
    const future = createOccurrence({
      scheduledFor: "2026-07-27T11:01:00.000Z",
    });
    await store.claim(before);
    await store.claim(exact);
    await store.claim(future);

    expectCanonicalPruningResult(
      await store.pruneCompletedThrough(createCursor()),
      "pruned",
    );
    await expect(store.claim(before)).resolves.toEqual({ kind: "claimed" });
    await expect(store.claim(exact)).resolves.toEqual({ kind: "claimed" });
    await expect(store.claim(future)).resolves.toEqual({ kind: "duplicate" });
  });

  it("returns unchanged and preserves duplicates when all claims are after the cursor", async () => {
    const store = createStore();
    const future = createOccurrence({
      scheduledFor: "2026-07-27T11:01:00.000Z",
    });
    await store.claim(future);

    expectCanonicalPruningResult(
      await store.pruneCompletedThrough(createCursor()),
      "unchanged",
    );
    await expect(store.claim(future)).resolves.toEqual({ kind: "duplicate" });
  });

  it("is idempotent and does not retain a pruning watermark", async () => {
    const store = createStore();
    const occurrence = createOccurrence();
    const cursor = createCursor();
    await store.claim(occurrence);

    expectCanonicalPruningResult(
      await store.pruneCompletedThrough(cursor),
      "pruned",
    );
    expectCanonicalPruningResult(
      await store.pruneCompletedThrough(cursor),
      "unchanged",
    );
    await expect(store.claim(occurrence)).resolves.toEqual({ kind: "claimed" });
  });

  it("uses no system clock and leaves the supplied cursor unchanged", async () => {
    const dateNow = vi.spyOn(Date, "now");
    const cursor = createCursor();
    const snapshot = { ...cursor };
    const store = createStore();

    try {
      await store.pruneCompletedThrough(cursor);

      expect(dateNow).not.toHaveBeenCalled();
      expect(cursor).toEqual(snapshot);
      expect(Object.isFrozen(cursor)).toBe(true);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("exposes only claim and pruning without collection or lifecycle APIs", () => {
    const store =
      new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
    const prototypeMethods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(store) as object,
    ).sort();

    expect(Object.keys(store)).toEqual([]);
    expect(prototypeMethods).toEqual([
      "claim",
      "constructor",
      "pruneCompletedThrough",
    ]);
    expect(store).not.toHaveProperty("claims");
    expect(store).not.toHaveProperty("map");
    expect(store).not.toHaveProperty("set");
    expect(store).not.toHaveProperty("find");
    expect(store).not.toHaveProperty("list");
    expect(store).not.toHaveProperty("snapshot");
    expect(store).not.toHaveProperty("release");
    expect(store).not.toHaveProperty("remove");
    expect(store).not.toHaveProperty("clear");
    expect(store).not.toHaveProperty("reset");
    expect(store).not.toHaveProperty("complete");
    expect(store).not.toHaveProperty("fail");
    expect(Object.isFrozen(store)).toBe(true);
  });

  it("does not revalidate occurrences during claim", async () => {
    const occurrence = createOccurrence();
    const equivalent = createOccurrence();
    const createSpy = vi.spyOn(
      ServiceAvailabilityReconciliationOccurrence,
      "create",
    );
    const store = createStore();

    await store.claim(occurrence);
    await store.claim(equivalent);

    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it.each(["1970-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z"])(
    "treats %s only as exact identity without time behavior",
    async (instant) => {
      const occurrence = createOccurrence({ scheduledFor: instant });
      const store = createStore();
      const dateSpy = vi.spyOn(globalThis, "Date");
      const dateNowSpy = vi.spyOn(Date, "now");
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const processOnSpy = vi.spyOn(process, "on");
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      try {
        await store.claim(occurrence);
        await store.claim(occurrence);

        expect(dateSpy).not.toHaveBeenCalled();
        expect(dateNowSpy).not.toHaveBeenCalled();
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        expect(processOnSpy).not.toHaveBeenCalled();
        expect(consoleLogSpy).not.toHaveBeenCalled();
      } finally {
        dateSpy.mockRestore();
        dateNowSpy.mockRestore();
        setTimeoutSpy.mockRestore();
        processOnSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    },
  );
});
