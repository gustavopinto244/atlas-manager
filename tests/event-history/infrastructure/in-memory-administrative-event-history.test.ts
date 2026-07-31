import { describe, expect, it } from "vitest";

import { InMemoryAdministrativeEventHistory } from "../../../src/event-history/infrastructure/in-memory-administrative-event-history.js";

const SOURCE = {
  kind: "administrative" as const,
  actorId: "unattributed-local" as const,
};
const TARGET = { kind: "machine" as const, id: "atlas" as const };

function input(index: number, status: "started" | "succeeded" = "started") {
  return {
    attemptId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    occurredAt: "2026-08-01T12:00:00.000Z",
    source: SOURCE,
    target: TARGET,
    operation: "cancel_wake_alarm" as const,
    status,
    ...(status === "succeeded"
      ? { details: { mutationOutcome: "cancelled" as const } }
      : {}),
  };
}

describe("InMemoryAdministrativeEventHistory", () => {
  it("assigns contiguous sequences and supports immutable bounded queries", async () => {
    const store = new InMemoryAdministrativeEventHistory();
    await store.record(input(1));
    await store.record(input(1, "succeeded"));
    await store.record(input(2));

    const page = await store.query({ afterSequence: 1, limit: 1 });
    expect(page.events.map((event) => event.sequence)).toEqual([2]);
    expect(page.hasMore).toBe(true);
    expect(page.nextAfterSequence).toBe(2);
    expect(Object.isFrozen(page.events[0])).toBe(true);
    expect(await store.check()).toEqual({ outcome: "ready" });
  });

  it("serializes same-instance writes and preserves event order", async () => {
    const store = new InMemoryAdministrativeEventHistory();
    const events = await Promise.all([
      store.record(input(1)),
      store.record(input(2)),
      store.record(input(3)),
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("supports controlled safe failures", async () => {
    const writeFailure = new InMemoryAdministrativeEventHistory({
      recordFailure: new Error("hidden"),
    });
    await expect(writeFailure.record(input(1))).rejects.toMatchObject({
      code: "event_history_write_failed",
    });

    const readFailure = new InMemoryAdministrativeEventHistory({
      queryFailure: new Error("hidden"),
    });
    await expect(readFailure.query()).rejects.toMatchObject({
      code: "event_history_read_failed",
    });
    const unavailable = new InMemoryAdministrativeEventHistory({
      readiness: "unavailable",
    });
    await expect(unavailable.check()).resolves.toEqual({
      outcome: "unavailable",
      code: "event_history_unavailable",
    });
  });
});
