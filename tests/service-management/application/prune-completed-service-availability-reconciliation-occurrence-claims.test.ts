import { describe, expect, it, vi } from "vitest";

import type { ServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import { PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims } from "../../../src/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";

function createCursor(
  completedThrough = "2026-07-26T12:30:00.000Z",
): ServiceAvailabilityReconciliationSchedulerCursor {
  return ServiceAvailabilityReconciliationSchedulerCursor.create({
    completedThrough,
  });
}

function createSubject() {
  const read =
    vi.fn<ServiceAvailabilityReconciliationSchedulerCursorStore["read"]>();
  const advance =
    vi.fn<ServiceAvailabilityReconciliationSchedulerCursorStore["advance"]>();
  const claim =
    vi.fn<ServiceAvailabilityReconciliationOccurrenceClaimStore["claim"]>();
  const pruneCompletedThrough =
    vi.fn<
      ServiceAvailabilityReconciliationOccurrenceClaimStore["pruneCompletedThrough"]
    >();
  const cursorStore = { read, advance };
  const occurrenceClaimStore = { claim, pruneCompletedThrough };

  return {
    subject:
      new PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims(
        cursorStore,
        occurrenceClaimStore,
      ),
    cursorStore,
    occurrenceClaimStore,
    read,
    advance,
    claim,
    pruneCompletedThrough,
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

describe("PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims", () => {
  it("performs no dependency operation during construction", () => {
    const { read, advance, claim, pruneCompletedThrough } = createSubject();

    expect(read).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(pruneCompletedThrough).not.toHaveBeenCalled();
  });

  it("returns frozen no_cursor without accessing the claim store", async () => {
    const { subject, read, advance, claim, pruneCompletedThrough } =
      createSubject();
    read.mockResolvedValue(null);

    const result = await subject.execute();

    expect(result).toEqual({ kind: "no_cursor" });
    expect(Object.keys(result)).toEqual(["kind"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(pruneCompletedThrough).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it.each(["pruned", "unchanged"] as const)(
    "returns the exact frozen %s result for the exact authoritative cursor",
    async (kind) => {
      const {
        subject,
        cursorStore,
        occurrenceClaimStore,
        read,
        advance,
        claim,
        pruneCompletedThrough,
      } = createSubject();
      const cursor = createCursor();
      const cursorSnapshot = { ...cursor };
      const storeResult = Object.freeze({ kind });
      read.mockResolvedValue(cursor);
      pruneCompletedThrough.mockResolvedValue(storeResult);

      const result = await subject.execute();

      expect(result).toBe(storeResult);
      expect(Object.keys(result)).toEqual(["kind"]);
      expect(read).toHaveBeenCalledOnce();
      expect(pruneCompletedThrough).toHaveBeenCalledExactlyOnceWith(cursor);
      expect(pruneCompletedThrough.mock.calls[0]?.[0]).toBe(cursor);
      expect(cursor).toEqual(cursorSnapshot);
      expect(Object.isFrozen(cursorStore)).toBe(false);
      expect(Object.isFrozen(occurrenceClaimStore)).toBe(false);
      expect(advance).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    },
  );

  it("propagates cursor read failure unchanged without accessing the claim store", async () => {
    const failure = new Error("cursor unavailable");
    const { subject, read, advance, claim, pruneCompletedThrough } =
      createSubject();
    read.mockRejectedValue(failure);

    await expect(subject.execute()).rejects.toBe(failure);
    expect(Object.isFrozen(failure)).toBe(false);
    expect(read).toHaveBeenCalledOnce();
    expect(pruneCompletedThrough).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it("propagates pruning failure unchanged without retrying", async () => {
    const failure = new Error("claim pruning unavailable");
    const { subject, read, advance, claim, pruneCompletedThrough } =
      createSubject();
    const cursor = createCursor();
    read.mockResolvedValue(cursor);
    pruneCompletedThrough.mockRejectedValue(failure);

    await expect(subject.execute()).rejects.toBe(failure);
    expect(Object.isFrozen(failure)).toBe(false);
    expect(read).toHaveBeenCalledOnce();
    expect(pruneCompletedThrough).toHaveBeenCalledExactlyOnceWith(cursor);
    expect(claim).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it("waits for cursor reading before beginning pruning", async () => {
    const { subject, read, pruneCompletedThrough } = createSubject();
    const cursorRead =
      createDeferred<ServiceAvailabilityReconciliationSchedulerCursor | null>();
    const pruning = createDeferred<Readonly<{ kind: "pruned" }>>();
    const cursor = createCursor();
    const storeResult = Object.freeze({ kind: "pruned" } as const);
    read.mockReturnValue(cursorRead.promise);
    pruneCompletedThrough.mockReturnValue(pruning.promise);

    const execution = subject.execute();

    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(pruneCompletedThrough).not.toHaveBeenCalled();

    cursorRead.resolve(cursor);
    await vi.waitFor(() =>
      expect(pruneCompletedThrough).toHaveBeenCalledExactlyOnceWith(cursor),
    );

    pruning.resolve(storeResult);
    await expect(execution).resolves.toBe(storeResult);
  });

  it("reads authoritative cursor state again on every execution", async () => {
    const { subject, read, pruneCompletedThrough } = createSubject();
    const cursor = createCursor();
    const prunedResult = Object.freeze({ kind: "pruned" } as const);
    read.mockResolvedValueOnce(null).mockResolvedValueOnce(cursor);
    pruneCompletedThrough.mockResolvedValue(prunedResult);

    await expect(subject.execute()).resolves.toEqual({ kind: "no_cursor" });
    await expect(subject.execute()).resolves.toBe(prunedResult);

    expect(read).toHaveBeenCalledTimes(2);
    expect(pruneCompletedThrough).toHaveBeenCalledExactlyOnceWith(cursor);
  });

  it("preserves repeated authoritative store outcomes unchanged", async () => {
    const { subject, read, pruneCompletedThrough } = createSubject();
    const cursor = createCursor();
    const prunedResult = Object.freeze({ kind: "pruned" } as const);
    const unchangedResult = Object.freeze({ kind: "unchanged" } as const);
    read.mockResolvedValue(cursor);
    pruneCompletedThrough
      .mockResolvedValueOnce(prunedResult)
      .mockResolvedValueOnce(unchangedResult);

    await expect(subject.execute()).resolves.toBe(prunedResult);
    await expect(subject.execute()).resolves.toBe(unchangedResult);

    expect(read).toHaveBeenCalledTimes(2);
    expect(pruneCompletedThrough).toHaveBeenCalledTimes(2);
  });

  it("uses no implicit clock, timer, environment, or process listener", async () => {
    const { subject, read, pruneCompletedThrough } = createSubject();
    const dateNow = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOn = vi.spyOn(process, "on");
    const cursor = createCursor();
    read.mockResolvedValue(cursor);
    pruneCompletedThrough.mockResolvedValue(
      Object.freeze({ kind: "unchanged" }),
    );

    try {
      await subject.execute();

      expect(dateNow).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOn).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      setTimeoutSpy.mockRestore();
      processOn.mockRestore();
    }
  });
});
