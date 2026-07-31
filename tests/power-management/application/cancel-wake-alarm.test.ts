/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { CancelWakeAlarm } from "../../../src/power-management/application/cancel-wake-alarm.js";
import type { WakeAlarmController } from "../../../src/power-management/application/ports/wake-alarm-controller.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import { createWakeAlarmMutationResult } from "../../../src/power-management/domain/wake-alarm-mutation-result.js";

const REQUESTED_AT = "2026-07-31T12:00:00.000Z";
const CANCELLED = createWakeAlarmMutationResult({
  operation: "cancel",
  requestedAt: REQUESTED_AT,
  outcome: "cancelled",
  before: { state: "scheduled", scheduledFor: "2026-08-01T06:00:00.000Z" },
  after: { state: "not_scheduled" },
});
const NOT_SCHEDULED = createWakeAlarmMutationResult({
  operation: "cancel",
  requestedAt: REQUESTED_AT,
  outcome: "not_scheduled",
  before: { state: "not_scheduled" },
  after: { state: "not_scheduled" },
});

function createClock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(REQUESTED_AT)) };
}

describe("CancelWakeAlarm", () => {
  it("captures one instant and cancels once without a preliminary query", async () => {
    const controller: WakeAlarmController = {
      schedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue(CANCELLED),
    };
    const useCase = new CancelWakeAlarm(createClock(), controller);

    await expect(useCase.execute()).resolves.toBe(CANCELLED);
    expect(controller.cancel).toHaveBeenCalledOnce();
    expect(controller.cancel).toHaveBeenCalledWith(REQUESTED_AT);
    expect(controller.schedule).not.toHaveBeenCalled();
  });

  it("returns a successful not-scheduled no-op unchanged", async () => {
    const controller: WakeAlarmController = {
      schedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue(NOT_SCHEDULED),
    };

    await expect(
      new CancelWakeAlarm(createClock(), controller).execute(),
    ).resolves.toBe(NOT_SCHEDULED);
  });

  it("preserves controller rejection without retry, fallback, or compensation", async () => {
    const failure = new Error("cancel-failure");
    const controller: WakeAlarmController = {
      schedule: vi.fn(),
      cancel: vi.fn().mockRejectedValue(failure),
    };

    await expect(
      new CancelWakeAlarm(createClock(), controller).execute(),
    ).rejects.toBe(failure);
    expect(controller.cancel).toHaveBeenCalledOnce();
    expect(controller.schedule).not.toHaveBeenCalled();
  });
});
