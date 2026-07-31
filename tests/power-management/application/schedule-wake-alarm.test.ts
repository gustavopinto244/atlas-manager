/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { ScheduleWakeAlarm } from "../../../src/power-management/application/schedule-wake-alarm.js";
import type { WakeAlarmController } from "../../../src/power-management/application/ports/wake-alarm-controller.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import { createWakeAlarmMutationResult } from "../../../src/power-management/domain/wake-alarm-mutation-result.js";

const REQUESTED_AT = "2026-07-31T12:00:00.000Z";
const SCHEDULED_FOR = "2026-08-01T06:00:00.000Z";
const RESULT = createWakeAlarmMutationResult({
  operation: "schedule",
  requestedAt: REQUESTED_AT,
  outcome: "scheduled",
  before: { state: "not_scheduled" },
  after: { state: "scheduled", scheduledFor: SCHEDULED_FOR },
});

function createClock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(REQUESTED_AT)) };
}

describe("ScheduleWakeAlarm", () => {
  it("validates before infrastructure, captures one instant, and passes both timestamps exactly", async () => {
    const clock = createClock();
    const controller: WakeAlarmController = {
      schedule: vi.fn().mockResolvedValue(RESULT),
      cancel: vi.fn(),
    };
    const useCase = new ScheduleWakeAlarm(clock, controller);

    await expect(
      useCase.execute({ scheduledFor: SCHEDULED_FOR }),
    ).resolves.toBe(RESULT);
    expect(clock.now).toHaveBeenCalledOnce();
    expect(controller.schedule).toHaveBeenCalledOnce();
    expect(controller.schedule).toHaveBeenCalledWith(
      REQUESTED_AT,
      SCHEDULED_FOR,
    );
  });

  it.each([
    ["malformed", "bad"],
    ["equal to request", REQUESTED_AT],
    ["before request", "2026-07-31T11:59:59.999Z"],
  ] as const)(
    "rejects %s input without controller call",
    async (_label, scheduledFor) => {
      const clock = createClock();
      const controller: WakeAlarmController = {
        schedule: vi.fn(),
        cancel: vi.fn(),
      };
      const useCase = new ScheduleWakeAlarm(clock, controller);

      await expect(useCase.execute({ scheduledFor })).rejects.toThrow();
      expect(controller.schedule).not.toHaveBeenCalled();
      expect(clock.now).toHaveBeenCalledTimes(scheduledFor === "bad" ? 0 : 1);
    },
  );

  it("returns scheduled, replaced, and unchanged controller results unchanged", async () => {
    const clock = createClock();
    const replaced = createWakeAlarmMutationResult({
      operation: "schedule",
      requestedAt: REQUESTED_AT,
      outcome: "replaced",
      before: { state: "scheduled", scheduledFor: SCHEDULED_FOR },
      after: { state: "scheduled", scheduledFor: "2026-08-02T06:00:00.000Z" },
    });
    const unchanged = createWakeAlarmMutationResult({
      operation: "schedule",
      requestedAt: REQUESTED_AT,
      outcome: "unchanged",
      before: { state: "scheduled", scheduledFor: SCHEDULED_FOR },
      after: { state: "scheduled", scheduledFor: SCHEDULED_FOR },
    });
    const controller: WakeAlarmController = {
      schedule: vi
        .fn()
        .mockResolvedValueOnce(RESULT)
        .mockResolvedValueOnce(replaced)
        .mockResolvedValueOnce(unchanged),
      cancel: vi.fn(),
    };
    const useCase = new ScheduleWakeAlarm(clock, controller);

    await expect(
      useCase.execute({ scheduledFor: SCHEDULED_FOR }),
    ).resolves.toBe(RESULT);
    await expect(
      useCase.execute({ scheduledFor: "2026-08-02T06:00:00.000Z" }),
    ).resolves.toBe(replaced);
    await expect(
      useCase.execute({ scheduledFor: SCHEDULED_FOR }),
    ).resolves.toBe(unchanged);
    expect(clock.now).toHaveBeenCalledTimes(3);
    expect(controller.schedule).toHaveBeenCalledTimes(3);
  });

  it("preserves controller rejection without retry, fallback, or compensation", async () => {
    const failure = new Error("schedule-failure");
    const controller: WakeAlarmController = {
      schedule: vi.fn().mockRejectedValue(failure),
      cancel: vi.fn(),
    };
    const useCase = new ScheduleWakeAlarm(createClock(), controller);

    await expect(useCase.execute({ scheduledFor: SCHEDULED_FOR })).rejects.toBe(
      failure,
    );
    expect(controller.schedule).toHaveBeenCalledOnce();
    expect(controller.cancel).not.toHaveBeenCalled();
  });

  it("performs no controller work during construction", () => {
    const controller: WakeAlarmController = {
      schedule: vi.fn(),
      cancel: vi.fn(),
    };

    new ScheduleWakeAlarm(createClock(), controller);

    expect(controller.schedule).not.toHaveBeenCalled();
    expect(controller.cancel).not.toHaveBeenCalled();
  });
});
