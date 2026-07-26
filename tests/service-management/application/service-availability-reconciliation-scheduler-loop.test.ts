import { describe, expect, it, vi } from "vitest";
import type { ServiceAvailabilityReconciliationSchedulerTimer } from "../../../src/service-management/application/ports/service-availability-reconciliation-scheduler-timer.js";
import { ServiceAvailabilityReconciliationSchedulerLoop } from "../../../src/service-management/application/service-availability-reconciliation-scheduler-loop.js";
import type {
  RunServiceAvailabilityReconciliationSchedulerCycle,
  ServiceAvailabilityReconciliationSchedulerCycleResult,
} from "../../../src/service-management/application/run-service-availability-reconciliation-scheduler-cycle.js";

describe("ServiceAvailabilityReconciliationSchedulerLoop", () => {
  it("performs no work during construction and runs the first cycle immediately", () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();

    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );

    expect(Object.isFrozen(loop)).toBe(true);
    expect(cycle.execute).not.toHaveBeenCalled();
    expect(timer.schedule).not.toHaveBeenCalled();

    void loop.start();

    expect(cycle.execute).toHaveBeenCalledTimes(1);
    expect(timer.schedule).not.toHaveBeenCalled();
  });

  it.each(["advanced", "idle"] as const)(
    "schedules one fixed-delay continuation after %s",
    async (kind) => {
      const cycle = createControlledCycle();
      const timer = createControlledTimer();
      const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
        cycle.dependency,
        timer.dependency,
      );

      const completion = loop.start();
      cycle.calls[0]!.resolve(createCycleResult(kind));
      await flushPromises();

      expect(timer.schedule).toHaveBeenCalledTimes(1);
      expect(timer.scheduled[0]!.delayMilliseconds).toBe(60_000);
      expect(cycle.execute).toHaveBeenCalledTimes(1);

      timer.scheduled[0]!.callback();
      expect(cycle.execute).toHaveBeenCalledTimes(2);

      cycle.calls[1]!.resolve(createCycleResult("conflict"));
      await expect(completion).resolves.toMatchObject({ kind: "conflict" });
    },
  );

  it("uses fixed delay and never schedules while a cycle is in flight", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );

    void loop.start();
    expect(timer.schedule).not.toHaveBeenCalled();

    cycle.calls[0]!.resolve(createCycleResult("advanced"));
    await flushPromises();
    timer.scheduled[0]!.callback();

    expect(cycle.execute).toHaveBeenCalledTimes(2);
    expect(timer.schedule).toHaveBeenCalledTimes(1);

    cycle.calls[1]!.resolve(createCycleResult("idle"));
    await flushPromises();
    expect(timer.schedule).toHaveBeenCalledTimes(2);
  });

  it("returns one completion promise and ignores repeated starts", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );

    const first = loop.start();
    const second = loop.start();

    expect(second).toBe(first);
    expect(cycle.execute).toHaveBeenCalledTimes(1);

    cycle.calls[0]!.resolve(createCycleResult("incomplete"));
    await first;
  });

  it.each(["incomplete", "conflict"] as const)(
    "terminates on %s and preserves the cycle result",
    async (kind) => {
      const cycle = createControlledCycle();
      const timer = createControlledTimer();
      const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
        cycle.dependency,
        timer.dependency,
      );
      const cycleResult = createCycleResult(kind);

      const completionPromise = loop.start();
      cycle.calls[0]!.resolve(cycleResult);
      const completion = await completionPromise;

      expect(completion.kind).toBe(kind);
      expect(Object.isFrozen(completion)).toBe(true);
      if (completion.kind === "incomplete" || completion.kind === "conflict") {
        expect(completion.cycleResult).toBe(cycleResult);
      }
      expect(timer.schedule).not.toHaveBeenCalled();
      expect(cycle.execute).toHaveBeenCalledTimes(1);
    },
  );

  it("terminates with the exact cycle error", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );
    const error = new Error("sentinel");

    const completionPromise = loop.start();
    cycle.calls[0]!.reject(error);

    await expect(completionPromise).resolves.toEqual({
      kind: "failed",
      error,
    });
    const completion = await completionPromise;
    expect(completion.kind === "failed" && completion.error).toBe(error);
    expect(Object.isFrozen(completion)).toBe(true);
    expect(timer.schedule).not.toHaveBeenCalled();
  });

  it("terminates with the exact timer scheduling error", async () => {
    const cycle = createControlledCycle();
    const error = new Error("schedule failed");
    const timer: ServiceAvailabilityReconciliationSchedulerTimer = {
      schedule: vi.fn(() => {
        throw error;
      }),
    };
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer,
    );

    const completionPromise = loop.start();
    cycle.calls[0]!.resolve(createCycleResult("advanced"));
    const completion = await completionPromise;

    expect(completion.kind === "failed" && completion.error).toBe(error);
    expect(Object.isFrozen(completion)).toBe(true);
  });

  it("cancels one pending timer and stops without accepting its callback", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );

    const startPromise = loop.start();
    cycle.calls[0]!.resolve(createCycleResult("advanced"));
    await flushPromises();

    const stopPromise = loop.stop();
    const completion = await stopPromise;

    expect(stopPromise).toBe(startPromise);
    expect(completion).toEqual({ kind: "stopped" });
    expect(Object.isFrozen(completion)).toBe(true);
    expect(timer.scheduled[0]!.cancel).toHaveBeenCalledTimes(1);

    timer.scheduled[0]!.callback();
    timer.scheduled[0]!.callback();
    expect(cycle.execute).toHaveBeenCalledTimes(1);
    expect(loop.stop()).toBe(startPromise);
    expect(timer.scheduled[0]!.cancel).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight continuable cycle before stopping", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );

    const startPromise = loop.start();
    const stopPromise = loop.stop();
    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });
    await flushPromises();
    expect(settled).toBe(false);

    cycle.calls[0]!.resolve(createCycleResult("idle"));
    const completion = await stopPromise;

    expect(stopPromise).toBe(startPromise);
    expect(completion).toEqual({ kind: "stopped" });
    expect(timer.schedule).not.toHaveBeenCalled();
  });

  it.each(["incomplete", "conflict"] as const)(
    "preserves %s when stop is requested during a cycle",
    async (kind) => {
      const cycle = createControlledCycle();
      const timer = createControlledTimer();
      const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
        cycle.dependency,
        timer.dependency,
      );
      const cycleResult = createCycleResult(kind);

      const completionPromise = loop.start();
      void loop.stop();
      cycle.calls[0]!.resolve(cycleResult);
      const completion = await completionPromise;

      expect(completion.kind).toBe(kind);
      if (completion.kind === "incomplete" || completion.kind === "conflict") {
        expect(completion.cycleResult).toBe(cycleResult);
      }
    },
  );

  it("preserves a rejection when stop is requested during a cycle", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );
    const error = new Error("cycle failed");

    const completionPromise = loop.start();
    void loop.stop();
    cycle.calls[0]!.reject(error);
    const completion = await completionPromise;

    expect(completion.kind === "failed" && completion.error).toBe(error);
  });

  it("stops before start and remains terminal", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );

    const stopPromise = loop.stop();
    const startPromise = loop.start();
    const completion = await stopPromise;

    expect(startPromise).toBe(stopPromise);
    expect(completion).toEqual({ kind: "stopped" });
    expect(Object.isFrozen(completion)).toBe(true);
    expect(cycle.execute).not.toHaveBeenCalled();
    expect(timer.schedule).not.toHaveBeenCalled();
  });

  it("fails with the exact pending-timer cancellation error", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const error = new Error("cancel failed");
    timer.cancelImplementation = () => {
      throw error;
    };
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );

    const completionPromise = loop.start();
    cycle.calls[0]!.resolve(createCycleResult("advanced"));
    await flushPromises();
    void loop.stop();
    const completion = await completionPromise;

    expect(completion.kind === "failed" && completion.error).toBe(error);
    timer.scheduled[0]!.callback();
    expect(cycle.execute).toHaveBeenCalledTimes(1);
  });

  it("defensively consumes a timer callback at most once", async () => {
    const cycle = createControlledCycle();
    const timer = createControlledTimer();
    const loop = new ServiceAvailabilityReconciliationSchedulerLoop(
      cycle.dependency,
      timer.dependency,
    );

    const completionPromise = loop.start();
    cycle.calls[0]!.resolve(createCycleResult("advanced"));
    await flushPromises();

    timer.scheduled[0]!.callback();
    timer.scheduled[0]!.callback();

    expect(cycle.execute).toHaveBeenCalledTimes(2);
    cycle.calls[1]!.resolve(createCycleResult("conflict"));
    await completionPromise;
  });
});

function createControlledCycle(): {
  dependency: RunServiceAvailabilityReconciliationSchedulerCycle;
  execute: ReturnType<typeof vi.fn>;
  calls: Deferred<ServiceAvailabilityReconciliationSchedulerCycleResult>[];
} {
  const calls: Deferred<ServiceAvailabilityReconciliationSchedulerCycleResult>[] =
    [];
  const execute = vi.fn(() => {
    const deferred =
      createDeferred<ServiceAvailabilityReconciliationSchedulerCycleResult>();
    calls.push(deferred);
    return deferred.promise;
  });

  return {
    dependency: {
      execute,
    } as unknown as RunServiceAvailabilityReconciliationSchedulerCycle,
    execute,
    calls,
  };
}

function createControlledTimer(): {
  dependency: ServiceAvailabilityReconciliationSchedulerTimer;
  schedule: ReturnType<typeof vi.fn>;
  scheduled: {
    delayMilliseconds: number;
    callback: () => void;
    cancel: ReturnType<typeof vi.fn>;
  }[];
  cancelImplementation: () => void;
} {
  const controlled = {
    scheduled: [] as {
      delayMilliseconds: number;
      callback: () => void;
      cancel: ReturnType<typeof vi.fn>;
    }[],
    cancelImplementation: (): void => undefined,
  };
  const schedule = vi.fn((delayMilliseconds: number, callback: () => void) => {
    const cancel = vi.fn(() => controlled.cancelImplementation());
    controlled.scheduled.push({ delayMilliseconds, callback, cancel });
    return Object.freeze({ cancel });
  });

  return {
    dependency: { schedule },
    schedule,
    get scheduled() {
      return controlled.scheduled;
    },
    get cancelImplementation() {
      return controlled.cancelImplementation;
    },
    set cancelImplementation(implementation: () => void) {
      controlled.cancelImplementation = implementation;
    },
  };
}

function createCycleResult(
  kind: ServiceAvailabilityReconciliationSchedulerCycleResult["kind"],
): ServiceAvailabilityReconciliationSchedulerCycleResult {
  if (kind === "idle") {
    return Object.freeze({
      kind,
      cursor: { completedThrough: "2026-07-26T12:30:00.000Z" },
    });
  }

  return Object.freeze({
    kind,
    cursor: null,
    report: Object.freeze([]),
  }) as ServiceAvailabilityReconciliationSchedulerCycleResult;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
