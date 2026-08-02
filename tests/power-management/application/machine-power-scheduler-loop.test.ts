import { describe, expect, it, vi } from "vitest";

import { MachinePowerSchedulerLoop } from "../../../src/power-management/application/machine-power-scheduler-loop.js";
import type { MachinePowerSchedulerResult } from "../../../src/power-management/domain/machine-power-scheduler-result.js";
import type {
  MachinePowerSchedulerTimer,
  MachinePowerSchedulerTimerHandle,
} from "../../../src/power-management/application/ports/machine-power-scheduler-timer.js";

describe("MachinePowerSchedulerLoop", () => {
  it("runs one immediate tick and schedules continuing results at the fixed cadence", async () => {
    const controlled = createControlledLoop(["initialized", "idle"]);
    const completion = controlled.loop.start();

    expect(controlled.tick).toHaveBeenCalledOnce();
    await flushPromises();
    expect(controlled.timer.delays).toEqual([60_000]);

    controlled.timer.callbacks[0]?.();
    await flushPromises();
    expect(controlled.tick).toHaveBeenCalledTimes(2);

    controlled.timer.callbacks[1]?.();
    await flushPromises();
    controlled.deferred?.resolve(result("blocked"));
    await expect(completion).resolves.toMatchObject({ kind: "blocked" });
  });

  it("does not overlap ticks and start is idempotent", async () => {
    const controlled = createControlledLoop([]);
    const first = controlled.loop.start();
    const second = controlled.loop.start();

    expect(second).toBe(first);
    expect(controlled.tick).toHaveBeenCalledOnce();
    expect(controlled.inFlight).toBe(1);

    controlled.deferred?.resolve(result("advanced"));
    await flushPromises();
    expect(controlled.inFlight).toBe(0);
    expect(controlled.timer.delays).toEqual([60_000]);
  });

  it.each(["blocked", "incomplete", "conflict"] as const)(
    "treats %s as terminal without scheduling another tick",
    async (kind) => {
      const controlled = createControlledLoop([kind]);
      const completion = controlled.loop.start();
      await expect(completion).resolves.toMatchObject({ kind });
      expect(controlled.timer.delays).toEqual([]);
    },
  );

  it("stops before start without creating a timer or running a tick", async () => {
    const controlled = createControlledLoop([]);

    await expect(controlled.loop.stop()).resolves.toEqual({ kind: "stopped" });
    expect(controlled.tick).not.toHaveBeenCalled();
    expect(controlled.timer.schedule).not.toHaveBeenCalled();
    await expect(controlled.loop.start()).resolves.toEqual({
      kind: "stopped",
    });
  });

  it("cancels a pending timer and waits for an in-flight tick", async () => {
    const controlled = createControlledLoop(["idle"]);
    const completion = controlled.loop.start();
    await flushPromises();
    const stop = controlled.loop.stop();

    expect(controlled.timer.cancel).toHaveBeenCalledOnce();
    await expect(stop).resolves.toEqual({ kind: "stopped" });
    expect(completion).toBe(stop);

    const inFlight = createControlledLoop([]);
    const inFlightCompletion = inFlight.loop.start();
    const inFlightStop = inFlight.loop.stop();
    expect(inFlightStop).toBe(inFlightCompletion);
    inFlight.deferred?.resolve(result("advanced"));
    await expect(inFlightStop).resolves.toEqual({ kind: "stopped" });
  });

  it("fails closed on tick, invalid-result, and timer failures", async () => {
    const rejected = new MachinePowerSchedulerLoop(
      { execute: vi.fn(() => Promise.reject(new TypeError("secret"))) },
      createTimer(),
    );
    await expect(rejected.start()).resolves.toMatchObject({ kind: "failed" });

    const invalid = new MachinePowerSchedulerLoop(
      { execute: vi.fn(() => Promise.resolve({ kind: "invalid" } as never)) },
      createTimer(),
    );
    await expect(invalid.start()).resolves.toMatchObject({ kind: "failed" });

    const timer = createTimer();
    timer.schedule.mockImplementation(() => {
      throw new Error("timer failure");
    });
    const timerFailure = new MachinePowerSchedulerLoop(
      { execute: vi.fn(() => Promise.resolve(result("idle"))) },
      timer,
    );
    await expect(timerFailure.start()).resolves.toMatchObject({
      kind: "failed",
    });
  });
});

function result(
  kind: MachinePowerSchedulerResult["kind"],
): MachinePowerSchedulerResult {
  return { kind } as MachinePowerSchedulerResult;
}

function createControlledLoop(
  kinds: readonly MachinePowerSchedulerResult["kind"][],
) {
  const timer = createTimer();
  const deferreds: Deferred<MachinePowerSchedulerResult>[] = [];
  let inFlight = 0;
  const tick = vi.fn(() => {
    inFlight += 1;
    const deferred = createDeferred<MachinePowerSchedulerResult>();
    deferreds.push(deferred);
    const kind = kinds[deferreds.length - 1];
    if (kind !== undefined) deferred.resolve(result(kind));
    return deferred.promise.finally(() => {
      inFlight -= 1;
    });
  });
  const loop = new MachinePowerSchedulerLoop({ execute: tick }, timer);
  return {
    loop,
    tick,
    timer,
    get deferred() {
      return deferreds.at(-1);
    },
    get inFlight() {
      return inFlight;
    },
  };
}

function createTimer() {
  const callbacks: (() => void)[] = [];
  const delays: number[] = [];
  const cancel = vi.fn();
  const schedule = vi.fn((_delay: number, callback: () => void) => {
    delays.push(_delay);
    callbacks.push(callback);
    return { cancel } satisfies MachinePowerSchedulerTimerHandle;
  });
  const timer: MachinePowerSchedulerTimer = {
    schedule,
  };
  return {
    ...timer,
    schedule,
    callbacks,
    cancel,
    delays,
  } as MachinePowerSchedulerTimer & {
    schedule: typeof schedule;
    callbacks: (() => void)[];
    cancel: ReturnType<typeof vi.fn>;
    delays: number[];
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
