import { describe, expect, it, vi } from "vitest";

import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";

describe("mock-first power-management integration", () => {
  it("reads simulated RTC information and requests simulated shutdown", async () => {
    const observedAt = "2026-07-31T12:00:00.000Z";
    const clock = { now: vi.fn(() => new Date(observedAt)) };
    const capabilities = createPowerManagement({
      clock,
      mockRtcInformation: {
        rtcTime: "2026-07-31T09:00:00.000Z",
        wakeAlarm: {
          state: "scheduled",
          scheduledFor: "2026-08-01T06:00:00.000Z",
        },
      },
    });

    const rtcInformation = await capabilities.getRtcInformation.execute();
    const shutdownResult = await capabilities.requestMachineShutdown.execute();

    expect(rtcInformation).toEqual({
      observedAt,
      rtcTime: "2026-07-31T09:00:00.000Z",
      wakeAlarm: {
        state: "scheduled",
        scheduledFor: "2026-08-01T06:00:00.000Z",
      },
    });
    expect(shutdownResult).toEqual({
      operation: "shutdown",
      requestedAt: observedAt,
      outcome: "simulated",
    });
    expect(Object.isFrozen(rtcInformation)).toBe(true);
    expect(Object.isFrozen(rtcInformation.wakeAlarm)).toBe(true);
    expect(Object.isFrozen(shutdownResult)).toBe(true);
    expect(clock.now).toHaveBeenCalledTimes(2);
  });
});
