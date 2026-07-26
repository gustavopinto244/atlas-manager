import { describe, expect, it, vi } from "vitest";
import { NodeServiceAvailabilityReconciliationSchedulerTimer } from "../../../src/service-management/infrastructure/node-service-availability-reconciliation-scheduler-timer.js";

describe("NodeServiceAvailabilityReconciliationSchedulerTimer", () => {
  it("creates no timeout during construction", () => {
    const scheduleTimeout = vi.fn();
    const cancelTimeout = vi.fn();

    const timer = new NodeServiceAvailabilityReconciliationSchedulerTimer(
      scheduleTimeout,
      cancelTimeout,
    );

    expect(Object.isFrozen(timer)).toBe(true);
    expect(scheduleTimeout).not.toHaveBeenCalled();
    expect(cancelTimeout).not.toHaveBeenCalled();
  });

  it("forwards the exact delay and invokes the callback at most once", () => {
    const nativeHandle = Object.freeze({ id: "native" });
    let scheduledCallback: (() => void) | undefined;
    const scheduleTimeout = vi.fn(
      (callback: () => void, delayMilliseconds?: number) => {
        void delayMilliseconds;
        scheduledCallback = callback;
        return nativeHandle;
      },
    );
    const cancelTimeout = vi.fn();
    const callback = vi.fn();
    const timer = new NodeServiceAvailabilityReconciliationSchedulerTimer(
      scheduleTimeout,
      cancelTimeout,
    );

    const handle = timer.schedule(60_000, callback);

    expect(scheduleTimeout).toHaveBeenCalledTimes(1);
    expect(scheduleTimeout.mock.calls[0]![1]).toBe(60_000);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.keys(handle)).toEqual(["cancel"]);

    scheduledCallback!();
    scheduledCallback!();

    expect(callback).toHaveBeenCalledTimes(1);
    handle.cancel();
    expect(cancelTimeout).not.toHaveBeenCalled();
  });

  it("cancels a pending timeout once and prevents its callback", () => {
    const nativeHandle = Object.freeze({ id: "native" });
    let scheduledCallback: (() => void) | undefined;
    const scheduleTimeout = vi.fn((callback: () => void) => {
      scheduledCallback = callback;
      return nativeHandle;
    });
    const cancelTimeout = vi.fn();
    const callback = vi.fn();
    const timer = new NodeServiceAvailabilityReconciliationSchedulerTimer(
      scheduleTimeout,
      cancelTimeout,
    );
    const handle = timer.schedule(1234, callback);

    handle.cancel();
    handle.cancel();
    scheduledCallback!();

    expect(cancelTimeout).toHaveBeenCalledTimes(1);
    expect(cancelTimeout).toHaveBeenCalledWith(nativeHandle);
    expect(callback).not.toHaveBeenCalled();
  });
});
