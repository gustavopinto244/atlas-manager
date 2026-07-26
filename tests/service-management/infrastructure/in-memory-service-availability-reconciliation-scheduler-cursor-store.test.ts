import { describe, expect, it, vi } from "vitest";

import type {
  ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult,
  ServiceAvailabilityReconciliationSchedulerCursorStore,
} from "../../../src/service-management/application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import {
  InMemoryServiceAvailabilityReconciliationSchedulerCursorStore,
  ServiceAvailabilityReconciliationSchedulerCursorStoreError,
} from "../../../src/service-management/infrastructure/in-memory-service-availability-reconciliation-scheduler-cursor-store.js";

function createCursor(
  completedThrough: string,
): ServiceAvailabilityReconciliationSchedulerCursor {
  return ServiceAvailabilityReconciliationSchedulerCursor.create({
    completedThrough,
  });
}

function createStore(): ServiceAvailabilityReconciliationSchedulerCursorStore {
  return new InMemoryServiceAvailabilityReconciliationSchedulerCursorStore();
}

function expectFrozenResult(
  result: ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult,
  expectedKeys: readonly string[],
): void {
  expect(Object.keys(result)).toEqual(expectedKeys);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Reflect.set(result, "kind", "changed")).toBe(false);
  expect(Reflect.set(result, "cursor", null)).toBe(false);
  expect(Reflect.set(result, "metadata", "private")).toBe(false);
  expect(Reflect.deleteProperty(result, "kind")).toBe(false);
}

describe("InMemoryServiceAvailabilityReconciliationSchedulerCursorStore", () => {
  it("starts empty, is frozen, and reads without changing state", async () => {
    const store =
      new InMemoryServiceAvailabilityReconciliationSchedulerCursorStore();

    await expect(store.read()).resolves.toBeNull();
    await expect(store.read()).resolves.toBeNull();
    expect(Object.isFrozen(store)).toBe(true);
    expect(Object.keys(store)).toEqual([]);
  });

  it("advances from null and preserves the exact cursor by identity", async () => {
    const store = createStore();
    const next = createCursor("2026-07-26T12:30:00.000Z");

    const result = await store.advance(null, next);

    expect(result).toEqual({ kind: "advanced", cursor: next });
    expect(result.cursor).toBe(next);
    expect(await store.read()).toBe(next);
    expectFrozenResult(result, ["kind", "cursor"]);
  });

  it("advances sequentially through strictly increasing cursors", async () => {
    const store = createStore();
    const first = createCursor("2026-07-26T12:30:00.000Z");
    const second = createCursor("2026-07-26T12:31:00.000Z");
    const third = createCursor("2026-07-27T00:00:00.000Z");

    await expect(store.advance(null, first)).resolves.toEqual({
      kind: "advanced",
      cursor: first,
    });
    await expect(store.advance(first, second)).resolves.toEqual({
      kind: "advanced",
      cursor: second,
    });
    await expect(store.advance(second, third)).resolves.toEqual({
      kind: "advanced",
      cursor: third,
    });
    expect(await store.read()).toBe(third);
  });

  it("returns a frozen conflict with the exact current cursor for stale state", async () => {
    const store = createStore();
    const current = createCursor("2026-07-26T12:30:00.000Z");
    const stale = createCursor("2026-07-26T12:29:00.000Z");
    const next = createCursor("2026-07-26T12:31:00.000Z");
    await store.advance(null, current);

    const result = await store.advance(stale, next);

    expect(result).toEqual({ kind: "conflict", cursor: current });
    expect(result.cursor).toBe(current);
    expect(await store.read()).toBe(current);
    expectFrozenResult(result, ["kind", "cursor"]);
  });

  it("returns conflict with null when a stale writer expects a cursor in an empty store", async () => {
    const store = createStore();
    const expected = createCursor("2026-07-26T12:30:00.000Z");
    const next = createCursor("2026-07-26T12:31:00.000Z");

    const result = await store.advance(expected, next);

    expect(result).toEqual({ kind: "conflict", cursor: null });
    expectFrozenResult(result, ["kind", "cursor"]);
    await expect(store.read()).resolves.toBeNull();
  });

  it("matches an independently reconstructed expected cursor by value", async () => {
    const store = createStore();
    const current = createCursor("2026-07-26T12:30:00.000Z");
    const equivalent = createCursor("2026-07-26T12:30:00.000Z");
    const next = createCursor("2026-07-26T12:31:00.000Z");
    await store.advance(null, current);

    const result = await store.advance(equivalent, next);

    expect(result).toEqual({ kind: "advanced", cursor: next });
    expect(await store.read()).toBe(next);
  });

  it.each(["2026-07-26T12:30:00.000Z", "2026-07-26T12:29:00.000Z"])(
    "rejects matching-state non-forward advancement to %s without mutation",
    async (nextTimestamp) => {
      const store = createStore();
      const current = createCursor("2026-07-26T12:30:00.000Z");
      const next = createCursor(nextTimestamp);
      await store.advance(null, current);

      await expect(store.advance(current, next)).rejects.toMatchObject({
        name: "ServiceAvailabilityReconciliationSchedulerCursorStoreError",
        code: "non_forward_cursor",
        message:
          "Service availability reconciliation scheduler cursor store failed: non_forward_cursor",
      });
      expect(await store.read()).toBe(current);
    },
  );

  it("gives stale-state conflict precedence over forward validation", async () => {
    const store = createStore();
    const current = createCursor("2026-07-26T12:30:00.000Z");
    const stale = createCursor("2026-07-26T12:29:00.000Z");
    await store.advance(null, current);

    await expect(store.advance(stale, current)).resolves.toEqual({
      kind: "conflict",
      cursor: current,
    });
    await expect(store.advance(stale, stale)).resolves.toEqual({
      kind: "conflict",
      cursor: current,
    });
    expect(await store.read()).toBe(current);
  });

  it.each([2, 10, 100])(
    "atomically permits one of %i concurrent advances from the same state",
    async (advanceCount) => {
      const store = createStore();
      const current = createCursor("2026-07-26T12:30:00.000Z");
      await store.advance(null, current);
      const nextCursors = Array.from({ length: advanceCount }, (_, index) =>
        createCursor(
          new Date(
            Date.parse(current.completedThrough) + (index + 1) * 60_000,
          ).toISOString(),
        ),
      );

      const results = await Promise.all(
        nextCursors.map((next) => store.advance(current, next)),
      );

      expect(results.filter(({ kind }) => kind === "advanced")).toHaveLength(1);
      expect(results.filter(({ kind }) => kind === "conflict")).toHaveLength(
        advanceCount - 1,
      );
      const advanced = results.find(({ kind }) => kind === "advanced");
      expect(await store.read()).toBe(advanced?.cursor);
    },
  );

  it("keeps state isolated between store instances", async () => {
    const first = createStore();
    const second = createStore();
    const cursor = createCursor("2026-07-26T12:30:00.000Z");

    await first.advance(null, cursor);

    expect(await first.read()).toBe(cursor);
    await expect(second.read()).resolves.toBeNull();
    await expect(second.advance(null, cursor)).resolves.toEqual({
      kind: "advanced",
      cursor,
    });
  });

  it("exposes only read and advance without lifecycle or storage APIs", () => {
    const store =
      new InMemoryServiceAvailabilityReconciliationSchedulerCursorStore();
    const prototypeMethods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(store) as object,
    ).sort();

    expect(prototypeMethods).toEqual(["advance", "constructor", "read"]);
    expect(store).not.toHaveProperty("cursor");
    expect(store).not.toHaveProperty("reset");
    expect(store).not.toHaveProperty("retry");
    expect(store).not.toHaveProperty("lock");
    expect(store).not.toHaveProperty("lease");
  });

  it("uses a safe non-forward error without exposing cursor values", async () => {
    const store = createStore();
    const cursor = createCursor("2026-07-26T12:30:00.000Z");
    await store.advance(null, cursor);

    try {
      await store.advance(cursor, cursor);
    } catch (error) {
      expect(error).toBeInstanceOf(
        ServiceAvailabilityReconciliationSchedulerCursorStoreError,
      );
      expect(error).not.toHaveProperty("cause");
      expect(Object.keys(error as object)).toEqual(["code", "name"]);
      expect((error as Error).message).not.toContain(cursor.completedThrough);
      return;
    }

    throw new Error("Expected non-forward advancement to fail");
  });

  it("does not access current time, timers, environment, or process listeners", async () => {
    const dateNow = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOn = vi.spyOn(process, "on");
    const store = createStore();
    const cursor = createCursor("2026-07-26T12:30:00.000Z");

    await store.read();
    await store.advance(null, cursor);
    await store.read();

    expect(dateNow).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(processOn).not.toHaveBeenCalled();
  });
});
