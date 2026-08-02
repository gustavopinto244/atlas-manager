import { describe, expect, it, vi } from "vitest";

import { NodeMachinePowerSchedulerTimer } from "../../../src/power-management/infrastructure/node-machine-power-scheduler-timer.js";

describe("NodeMachinePowerSchedulerTimer", () => {
  it("uses one cancellable one-shot timeout", () => {
    let callback: (() => void) | undefined;
    const schedule = vi.fn((_callback: () => void, delay: number) => {
      callback = _callback;
      expect(delay).toBe(60_000);
      return "handle";
    });
    const cancel = vi.fn();
    const timer = new NodeMachinePowerSchedulerTimer(schedule, cancel);
    const work = vi.fn();
    const handle = timer.schedule(60_000, work);

    callback?.();
    callback?.();
    handle.cancel();
    handle.cancel();

    expect(schedule).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels an active timeout exactly once", () => {
    const schedule = vi.fn(() => "handle");
    const cancel = vi.fn();
    const handle = new NodeMachinePowerSchedulerTimer(
      schedule,
      cancel,
    ).schedule(60_000, vi.fn());

    handle.cancel();
    handle.cancel();

    expect(cancel).toHaveBeenCalledExactlyOnceWith("handle");
  });
});
