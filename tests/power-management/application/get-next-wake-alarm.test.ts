/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { GetNextWakeAlarm } from "../../../src/power-management/application/get-next-wake-alarm.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import type { WakeAlarmReader } from "../../../src/power-management/application/ports/wake-alarm-reader.js";
import { createWakeAlarmObservation } from "../../../src/power-management/domain/wake-alarm-observation.js";

const OBSERVED_AT = "2026-07-31T12:00:00.000Z";
const RESULT = createWakeAlarmObservation({
  observedAt: OBSERVED_AT,
  wakeAlarm: { state: "not_scheduled" },
});

function createClock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(OBSERVED_AT)) };
}

describe("GetNextWakeAlarm", () => {
  it("captures one instant, reads once, and returns the approved result", async () => {
    const clock = createClock();
    const reader: WakeAlarmReader = { read: vi.fn().mockResolvedValue(RESULT) };
    const useCase = new GetNextWakeAlarm(clock, reader);

    await expect(useCase.execute()).resolves.toBe(RESULT);
    expect(clock.now).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledWith(OBSERVED_AT);
  });

  it("preserves reader rejection without retry, fallback, or mutation", async () => {
    const failure = new Error("wake-alarm-reader-failure");
    const clock = createClock();
    const reader: WakeAlarmReader = {
      read: vi.fn().mockRejectedValue(failure),
    };
    const useCase = new GetNextWakeAlarm(clock, reader);

    await expect(useCase.execute()).rejects.toBe(failure);
    expect(clock.now).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledOnce();
  });

  it("performs no reader work during construction", () => {
    const reader: WakeAlarmReader = { read: vi.fn() };

    new GetNextWakeAlarm(createClock(), reader);

    expect(reader.read).not.toHaveBeenCalled();
  });
});
