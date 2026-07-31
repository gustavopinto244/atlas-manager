import { describe, expect, it } from "vitest";
import { InMemoryMachineShutdownOccurrenceClaimStore } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-occurrence-claim-store.js";

const occurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};

describe("in-memory machine shutdown occurrence claim store", () => {
  it("claims an exact occurrence once and keeps tuple members independent", async () => {
    const store = new InMemoryMachineShutdownOccurrenceClaimStore();
    await expect(store.claim(occurrence)).resolves.toEqual({
      outcome: "claimed",
    });
    await expect(store.claim({ ...occurrence })).resolves.toEqual({
      outcome: "duplicate",
    });
    await expect(
      store.claim({ ...occurrence, scheduledFor: "2026-08-03T22:00:00.000Z" }),
    ).resolves.toEqual({ outcome: "claimed" });
    await expect(
      store.claim({
        ...occurrence,
        wakeScheduledFor: "2026-08-04T13:00:00.000Z",
      }),
    ).resolves.toEqual({ outcome: "claimed" });
  });

  it("is atomic for concurrent equivalent claims and isolates instances", async () => {
    const store = new InMemoryMachineShutdownOccurrenceClaimStore();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.claim(occurrence)),
    );
    expect(
      results.filter((result) => result.outcome === "claimed"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.outcome === "duplicate"),
    ).toHaveLength(7);
    await expect(
      new InMemoryMachineShutdownOccurrenceClaimStore().claim(occurrence),
    ).resolves.toEqual({ outcome: "claimed" });
  });

  it("supports controlled rejection without consuming a claim", async () => {
    const failure = new Error("controlled");
    const store = new InMemoryMachineShutdownOccurrenceClaimStore({ failure });
    await expect(store.claim(occurrence)).rejects.toBe(failure);
  });
});
