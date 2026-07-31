import { describe, expect, it } from "vitest";

import { MockMachineShutdownController } from "../../../src/power-management/infrastructure/mock-machine-shutdown-controller.js";
import { MockRtcInformationReader } from "../../../src/power-management/infrastructure/mock-rtc-information-reader.js";

const OBSERVED_AT = "2026-07-31T12:00:00.000Z";
const RTC_TIME = "2026-07-31T09:00:00.000Z";

describe("MockRtcInformationReader", () => {
  it.each([
    [{ state: "unsupported" }, "unsupported"],
    [{ state: "not_scheduled" }, "not_scheduled"],
    [
      { state: "scheduled", scheduledFor: "2026-08-01T06:00:00.000Z" },
      "scheduled",
    ],
  ] as const)(
    "returns deterministic simulated %s information",
    async (wakeAlarm, state) => {
      const reader = new MockRtcInformationReader({
        rtcTime: RTC_TIME,
        wakeAlarm,
      });

      const result = await reader.read(OBSERVED_AT);

      expect(result).toEqual({
        observedAt: OBSERVED_AT,
        rtcTime: RTC_TIME,
        wakeAlarm,
      });
      expect(result.wakeAlarm.state).toBe(state);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.wakeAlarm)).toBe(true);
    },
  );

  it("preserves controlled timestamps and isolates mutable configuration", async () => {
    const wakeAlarm = {
      state: "scheduled",
      scheduledFor: "2026-08-01T06:00:00.000Z",
    };
    const reader = new MockRtcInformationReader({
      rtcTime: RTC_TIME,
      wakeAlarm,
    });
    wakeAlarm.scheduledFor = "2027-01-01T00:00:00.000Z";

    const first = await reader.read(OBSERVED_AT);
    const second = await reader.read("2026-07-31T12:01:00.000Z");

    expect(first.observedAt).toBe(OBSERVED_AT);
    expect(first.wakeAlarm).toEqual({
      state: "scheduled",
      scheduledFor: "2026-08-01T06:00:00.000Z",
    });
    expect(second.observedAt).toBe("2026-07-31T12:01:00.000Z");
    expect(second).not.toBe(first);
  });

  it("preserves a controlled rejection", async () => {
    const failure = new Error("simulated-rtc-failure");
    const reader = new MockRtcInformationReader({
      rtcTime: RTC_TIME,
      wakeAlarm: { state: "unsupported" },
      failure,
    });

    await expect(reader.read(OBSERVED_AT)).rejects.toBe(failure);
  });
});

describe("MockMachineShutdownController", () => {
  it("returns one immutable simulated shutdown result", async () => {
    const controller = new MockMachineShutdownController();

    const result = await controller.requestShutdown(OBSERVED_AT);

    expect(result).toEqual({
      operation: "shutdown",
      requestedAt: OBSERVED_AT,
      outcome: "simulated",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("is deterministic across independent calls and preserves the timestamp", async () => {
    const controller = new MockMachineShutdownController();

    const first = await controller.requestShutdown(OBSERVED_AT);
    const second = await controller.requestShutdown(OBSERVED_AT);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("preserves a controlled rejection without substituting another operation", async () => {
    const failure = new Error("simulated-shutdown-failure");
    const controller = new MockMachineShutdownController({ failure });

    await expect(controller.requestShutdown(OBSERVED_AT)).rejects.toBe(failure);
  });
});
