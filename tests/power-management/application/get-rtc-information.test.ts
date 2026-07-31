/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { GetRtcInformation } from "../../../src/power-management/application/get-rtc-information.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import type { RtcInformationReader } from "../../../src/power-management/application/ports/rtc-information-reader.js";
import { createRtcInformation } from "../../../src/power-management/domain/rtc-information.js";

const OBSERVED_AT = "2026-07-31T12:00:00.000Z";
const RESULT = createRtcInformation({
  observedAt: OBSERVED_AT,
  rtcTime: "2026-07-31T09:00:00.000Z",
  wakeAlarm: { state: "unsupported" },
});

function createClock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(OBSERVED_AT)) };
}

describe("GetRtcInformation", () => {
  it("captures one clock instant and passes it exactly to the reader", async () => {
    const clock = createClock();
    const reader: RtcInformationReader = {
      read: vi.fn().mockResolvedValue(RESULT),
    };
    const useCase = new GetRtcInformation(clock, reader);

    expect(await useCase.execute()).toBe(RESULT);
    expect(clock.now).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledWith(OBSERVED_AT);
  });

  it("preserves reader rejection without retry or fallback", async () => {
    const failure = new Error("rtc-reader-failure");
    const clock = createClock();
    const reader: RtcInformationReader = {
      read: vi.fn().mockRejectedValue(failure),
    };
    const useCase = new GetRtcInformation(clock, reader);

    await expect(useCase.execute()).rejects.toBe(failure);
    expect(clock.now).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledOnce();
  });

  it("performs no reader work during construction", () => {
    const reader: RtcInformationReader = { read: vi.fn() };

    new GetRtcInformation(createClock(), reader);

    expect(reader.read).not.toHaveBeenCalled();
  });
});
