/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import type { MachineShutdownController } from "../../../src/power-management/application/ports/machine-shutdown-controller.js";
import { createSequenceClock } from "../../test-helpers/controlled-time.js";

describe("mock-first power-management integration", () => {
  it("reads simulated RTC information and requests simulated shutdown", async () => {
    const observedAt = "2026-07-31T12:00:00.000Z";
    const clock = { now: vi.fn(() => new Date(observedAt)) };
    const capabilities = createPowerManagement({
      clock,
      mockRtcInformation: {
        rtcTime: "2026-07-31T09:00:00.000Z",
      },
      mockWakeAlarmState: {
        initialWakeAlarm: {
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

  it("completes the deterministic schedule, replacement, unchanged, and cancellation lifecycle", async () => {
    const clock = createSequenceClock([
      new Date("2026-07-31T12:00:00.000Z"),
      new Date("2026-07-31T12:00:01.000Z"),
      new Date("2026-07-31T12:00:02.000Z"),
      new Date("2026-07-31T12:00:03.000Z"),
      new Date("2026-07-31T12:00:04.000Z"),
      new Date("2026-07-31T12:00:05.000Z"),
      new Date("2026-07-31T12:00:06.000Z"),
      new Date("2026-07-31T12:00:07.000Z"),
      new Date("2026-07-31T12:00:08.000Z"),
      new Date("2026-07-31T12:00:09.000Z"),
      new Date("2026-07-31T12:00:10.000Z"),
    ]);
    const capabilities = createPowerManagement({ clock });
    const t1 = "2026-08-01T06:00:00.000Z";
    const t2 = "2026-08-02T06:00:00.000Z";

    await expect(capabilities.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: "2026-07-31T12:00:00.000Z",
      wakeAlarm: { state: "not_scheduled" },
    });
    const scheduled = await capabilities.scheduleWakeAlarm.execute({
      scheduledFor: t1,
    });
    expect(scheduled).toEqual({
      operation: "schedule",
      requestedAt: "2026-07-31T12:00:01.000Z",
      outcome: "scheduled",
      before: { state: "not_scheduled" },
      after: { state: "scheduled", scheduledFor: t1 },
    });
    expect(Object.isFrozen(scheduled)).toBe(true);
    expect(Object.isFrozen(scheduled.before)).toBe(true);
    expect(Object.isFrozen(scheduled.after)).toBe(true);
    await expect(capabilities.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: "2026-07-31T12:00:02.000Z",
      wakeAlarm: { state: "scheduled", scheduledFor: t1 },
    });
    await expect(capabilities.getRtcInformation.execute()).resolves.toEqual(
      expect.objectContaining({
        observedAt: "2026-07-31T12:00:03.000Z",
        wakeAlarm: { state: "scheduled", scheduledFor: t1 },
      }),
    );

    await expect(
      capabilities.scheduleWakeAlarm.execute({ scheduledFor: t2 }),
    ).resolves.toEqual({
      operation: "schedule",
      requestedAt: "2026-07-31T12:00:04.000Z",
      outcome: "replaced",
      before: { state: "scheduled", scheduledFor: t1 },
      after: { state: "scheduled", scheduledFor: t2 },
    });
    await expect(capabilities.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: "2026-07-31T12:00:05.000Z",
      wakeAlarm: { state: "scheduled", scheduledFor: t2 },
    });
    await expect(
      capabilities.scheduleWakeAlarm.execute({ scheduledFor: t2 }),
    ).resolves.toEqual({
      operation: "schedule",
      requestedAt: "2026-07-31T12:00:06.000Z",
      outcome: "unchanged",
      before: { state: "scheduled", scheduledFor: t2 },
      after: { state: "scheduled", scheduledFor: t2 },
    });
    await expect(capabilities.cancelWakeAlarm.execute()).resolves.toEqual({
      operation: "cancel",
      requestedAt: "2026-07-31T12:00:07.000Z",
      outcome: "cancelled",
      before: { state: "scheduled", scheduledFor: t2 },
      after: { state: "not_scheduled" },
    });
    await expect(capabilities.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: "2026-07-31T12:00:08.000Z",
      wakeAlarm: { state: "not_scheduled" },
    });
    await expect(capabilities.getRtcInformation.execute()).resolves.toEqual(
      expect.objectContaining({
        observedAt: "2026-07-31T12:00:09.000Z",
        wakeAlarm: { state: "not_scheduled" },
      }),
    );
    await expect(capabilities.cancelWakeAlarm.execute()).resolves.toEqual({
      operation: "cancel",
      requestedAt: "2026-07-31T12:00:10.000Z",
      outcome: "not_scheduled",
      before: { state: "not_scheduled" },
      after: { state: "not_scheduled" },
    });
    expect(clock.calls).toBe(11);
  });

  it("preserves shared state after a controlled replacement failure", async () => {
    const t1 = "2026-08-01T06:00:00.000Z";
    const failure = new Error("controlled-schedule-failure");
    const clock = createSequenceClock([
      new Date("2026-07-31T12:00:00.000Z"),
      new Date("2026-07-31T12:00:01.000Z"),
      new Date("2026-07-31T12:00:02.000Z"),
    ]);
    const capabilities = createPowerManagement({
      clock,
      mockWakeAlarmState: {
        initialWakeAlarm: { state: "scheduled", scheduledFor: t1 },
      },
      mockWakeAlarmController: { scheduleFailure: failure },
    });

    await expect(
      capabilities.scheduleWakeAlarm.execute({
        scheduledFor: "2026-08-02T06:00:00.000Z",
      }),
    ).rejects.toBe(failure);
    await expect(capabilities.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: "2026-07-31T12:00:01.000Z",
      wakeAlarm: { state: "scheduled", scheduledFor: t1 },
    });
    await expect(capabilities.getRtcInformation.execute()).resolves.toEqual(
      expect.objectContaining({
        observedAt: "2026-07-31T12:00:02.000Z",
        wakeAlarm: { state: "scheduled", scheduledFor: t1 },
      }),
    );
  });

  it("plans a weekly machine schedule without executing power operations", async () => {
    const clock = createSequenceClock([
      new Date("2026-08-03T10:00:00.000Z"),
      new Date("2026-08-03T10:00:00.000Z"),
      new Date("2026-08-03T11:00:00.000Z"),
      new Date("2026-08-03T15:00:00.000Z"),
      new Date("2026-08-03T21:00:00.000Z"),
      new Date("2026-08-04T21:00:00.000Z"),
      new Date("2026-08-04T21:00:00.000Z"),
    ]);
    const shutdownController: MachineShutdownController = {
      requestShutdown: vi.fn(),
    };
    const capabilities = createPowerManagement({
      clock,
      machineShutdownController: shutdownController,
      machineOperatingPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        weeklySchedule: {
          windows: [
            { dayOfWeek: "monday", start: "08:00", end: "12:00" },
            { dayOfWeek: "monday", start: "12:00", end: "18:00" },
            { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
          ],
        },
      },
    });
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    const wakeBefore = await capabilities.getNextWakeAlarm.execute();
    const beforeStart = capabilities.getMachinePowerPlan.execute();
    const atStart = capabilities.getMachinePowerPlan.execute();
    const atAdjacentBoundary = capabilities.getMachinePowerPlan.execute();
    const atEnd = capabilities.getMachinePowerPlan.execute();
    const afterFinalWindow = capabilities.getMachinePowerPlan.execute();
    const wakeAfter = await capabilities.getNextWakeAlarm.execute();

    expect(beforeStart).toMatchObject({
      expectation: "offline",
      nextWake: {
        state: "planned",
        scheduledFor: "2026-08-03T11:00:00.000Z",
      },
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-03T21:00:00.000Z",
      },
    });
    expect(atStart).toMatchObject({
      expectation: "operating",
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-03T21:00:00.000Z",
      },
      nextWake: {
        state: "planned",
        scheduledFor: "2026-08-04T12:00:00.000Z",
      },
    });
    expect(atAdjacentBoundary).toEqual(
      expect.objectContaining({
        expectation: "operating",
        nextShutdown: {
          state: "planned",
          scheduledFor: "2026-08-03T21:00:00.000Z",
        },
      }),
    );
    expect(atEnd).toMatchObject({
      expectation: "offline",
      nextWake: {
        state: "planned",
        scheduledFor: "2026-08-04T12:00:00.000Z",
      },
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-04T20:00:00.000Z",
      },
    });
    expect(afterFinalWindow).toMatchObject({
      expectation: "offline",
      nextWake: {
        state: "planned",
        scheduledFor: "2026-08-10T11:00:00.000Z",
      },
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-10T21:00:00.000Z",
      },
    });
    expect(Object.isFrozen(beforeStart)).toBe(true);
    expect(Object.isFrozen(beforeStart.nextShutdown)).toBe(true);
    expect(Object.isFrozen(beforeStart.nextWake)).toBe(true);
    expect(wakeAfter.wakeAlarm).toEqual(wakeBefore.wakeAlarm);
    expect(shutdownController.requestShutdown).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(clock.calls).toBe(7);

    timeoutSpy.mockRestore();
    intervalSpy.mockRestore();
  });
});
