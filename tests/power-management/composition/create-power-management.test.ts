/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import type { MachineShutdownController } from "../../../src/power-management/application/ports/machine-shutdown-controller.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import type { RtcInformationReader } from "../../../src/power-management/application/ports/rtc-information-reader.js";
import type { WakeAlarmController } from "../../../src/power-management/application/ports/wake-alarm-controller.js";
import type { WakeAlarmReader } from "../../../src/power-management/application/ports/wake-alarm-reader.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";
import { createRtcInformation } from "../../../src/power-management/domain/rtc-information.js";
import { createWakeAlarmMutationResult } from "../../../src/power-management/domain/wake-alarm-mutation-result.js";
import { createWakeAlarmObservation } from "../../../src/power-management/domain/wake-alarm-observation.js";

const NOW = "2026-07-31T12:00:00.000Z";

function createClock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(NOW)) };
}

describe("createPowerManagement", () => {
  it("returns frozen stable capabilities without performing work during construction", () => {
    const reader: RtcInformationReader = { read: vi.fn() };
    const controller: MachineShutdownController = {
      requestShutdown: vi.fn(),
    };
    const capabilities = createPowerManagement({
      clock: createClock(),
      rtcInformationReader: reader,
      machineShutdownController: controller,
    });

    const getRtcInformation = capabilities.getRtcInformation;
    const getNextWakeAlarm = capabilities.getNextWakeAlarm;
    const scheduleWakeAlarm = capabilities.scheduleWakeAlarm;
    const cancelWakeAlarm = capabilities.cancelWakeAlarm;
    const getMachinePowerPlan = capabilities.getMachinePowerPlan;
    const requestMachineShutdown = capabilities.requestMachineShutdown;
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities.getRtcInformation).toBe(getRtcInformation);
    expect(capabilities.getNextWakeAlarm).toBe(getNextWakeAlarm);
    expect(capabilities.scheduleWakeAlarm).toBe(scheduleWakeAlarm);
    expect(capabilities.cancelWakeAlarm).toBe(cancelWakeAlarm);
    expect(capabilities.getMachinePowerPlan).toBe(getMachinePowerPlan);
    expect(capabilities.requestMachineShutdown).toBe(requestMachineShutdown);
    expect(reader.read).not.toHaveBeenCalled();
    expect(controller.requestShutdown).not.toHaveBeenCalled();
  });

  it("uses the configured clock and narrow reader/controller seams", async () => {
    const readerResult = createRtcInformation({
      observedAt: NOW,
      rtcTime: "2026-07-31T09:00:00.000Z",
      wakeAlarm: { state: "unsupported" },
    });
    const shutdownResult = createMachineShutdownResult({
      operation: "shutdown",
      requestedAt: NOW,
      outcome: "simulated",
    });
    const clock = createClock();
    const reader: RtcInformationReader = {
      read: vi.fn().mockResolvedValue(readerResult),
    };
    const controller: MachineShutdownController = {
      requestShutdown: vi.fn().mockResolvedValue(shutdownResult),
    };
    const wakeAlarmResult = createWakeAlarmObservation({
      observedAt: NOW,
      wakeAlarm: { state: "not_scheduled" },
    });
    const mutationResult = createWakeAlarmMutationResult({
      operation: "cancel",
      requestedAt: NOW,
      outcome: "not_scheduled",
      before: { state: "not_scheduled" },
      after: { state: "not_scheduled" },
    });
    const wakeAlarmReader: WakeAlarmReader = {
      read: vi.fn().mockResolvedValue(wakeAlarmResult),
    };
    const wakeAlarmController: WakeAlarmController = {
      schedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue(mutationResult),
    };
    const capabilities = createPowerManagement({
      clock,
      rtcInformationReader: reader,
      wakeAlarmReader,
      wakeAlarmController,
      machineShutdownController: controller,
    });

    await expect(capabilities.getRtcInformation.execute()).resolves.toBe(
      readerResult,
    );
    await expect(capabilities.requestMachineShutdown.execute()).resolves.toBe(
      shutdownResult,
    );
    await expect(capabilities.getNextWakeAlarm.execute()).resolves.toBe(
      wakeAlarmResult,
    );
    await expect(capabilities.cancelWakeAlarm.execute()).resolves.toBe(
      mutationResult,
    );
    expect(clock.now).toHaveBeenCalledTimes(4);
    expect(reader.read).toHaveBeenCalledWith(NOW);
    expect(wakeAlarmReader.read).toHaveBeenCalledWith(NOW);
    expect(wakeAlarmController.cancel).toHaveBeenCalledWith(NOW);
    expect(controller.requestShutdown).toHaveBeenCalledWith(NOW);
  });

  it("constructs deterministic mock defaults without privileged dependencies", async () => {
    const capabilities = createPowerManagement({ clock: createClock() });

    await expect(capabilities.getRtcInformation.execute()).resolves.toEqual({
      observedAt: NOW,
      rtcTime: "2026-01-01T00:00:00.000Z",
      wakeAlarm: { state: "not_scheduled" },
    });
    await expect(
      capabilities.requestMachineShutdown.execute(),
    ).resolves.toEqual({
      operation: "shutdown",
      requestedAt: NOW,
      outcome: "simulated",
    });
  });

  it("supports explicit unsupported and scheduled initial alarm states", async () => {
    const unsupported = createPowerManagement({
      clock: createClock(),
      mockWakeAlarmState: { initialWakeAlarm: { state: "unsupported" } },
    });
    await expect(unsupported.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: NOW,
      wakeAlarm: { state: "unsupported" },
    });
    await expect(unsupported.getRtcInformation.execute()).resolves.toEqual(
      expect.objectContaining({ wakeAlarm: { state: "unsupported" } }),
    );
    await expect(
      unsupported.scheduleWakeAlarm.execute({
        scheduledFor: "2026-08-01T06:00:00.000Z",
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ name: "UnsupportedWakeAlarmMutationError" }),
    );

    const scheduled = createPowerManagement({
      clock: createClock(),
      mockWakeAlarmState: {
        initialWakeAlarm: {
          state: "scheduled",
          scheduledFor: "2026-08-01T06:00:00.000Z",
        },
      },
    });
    await expect(scheduled.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: NOW,
      wakeAlarm: {
        state: "scheduled",
        scheduledFor: "2026-08-01T06:00:00.000Z",
      },
    });
  });

  it("keeps RTC time unchanged while schedule and cancellation synchronize both queries", async () => {
    const capabilities = createPowerManagement({ clock: createClock() });
    const rtcBefore = await capabilities.getRtcInformation.execute();

    await capabilities.scheduleWakeAlarm.execute({
      scheduledFor: "2026-08-01T06:00:00.000Z",
    });
    const rtcScheduled = await capabilities.getRtcInformation.execute();
    const nextScheduled = await capabilities.getNextWakeAlarm.execute();
    await capabilities.cancelWakeAlarm.execute();
    const rtcAfter = await capabilities.getRtcInformation.execute();
    const nextAfter = await capabilities.getNextWakeAlarm.execute();

    expect(rtcBefore.rtcTime).toBe("2026-01-01T00:00:00.000Z");
    expect(rtcScheduled.rtcTime).toBe(rtcBefore.rtcTime);
    expect(rtcAfter.rtcTime).toBe(rtcBefore.rtcTime);
    expect(rtcScheduled.wakeAlarm).toEqual({
      state: "scheduled",
      scheduledFor: "2026-08-01T06:00:00.000Z",
    });
    expect(nextScheduled.wakeAlarm).toEqual(rtcScheduled.wakeAlarm);
    expect(rtcAfter.wakeAlarm).toEqual({ state: "not_scheduled" });
    expect(nextAfter.wakeAlarm).toEqual({ state: "not_scheduled" });
  });

  it("exposes an always-on plan by default", () => {
    const capabilities = createPowerManagement({ clock: createClock() });

    expect(capabilities.getMachinePowerPlan.execute()).toEqual({
      evaluatedAt: NOW,
      expectation: "operating",
      nextShutdown: { state: "not_planned" },
      nextWake: { state: "not_planned" },
    });
  });

  it("accepts scheduled policies and retains a frozen policy snapshot", () => {
    const policy = {
      mode: "scheduled" as const,
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }],
      },
    };
    const capabilities = createPowerManagement({
      clock: {
        now: vi.fn(() => new Date("2026-08-03T12:00:00.000Z")),
      },
      machineOperatingPolicy: policy,
    });
    policy.weeklySchedule.windows[0]!.start = "12:00";

    expect(capabilities.getMachinePowerPlan.execute()).toMatchObject({
      expectation: "operating",
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-03T21:00:00.000Z",
      },
    });
    expect(Object.isFrozen(capabilities.getMachinePowerPlan)).toBe(true);
  });

  it("accepts manual mode and rejects malformed policy configuration", () => {
    const manual = createPowerManagement({
      clock: createClock(),
      machineOperatingPolicy: { mode: "manual" },
    });
    expect(manual.getMachinePowerPlan.execute().expectation).toBe("manual");

    expect(() =>
      createPowerManagement({
        clock: createClock(),
        machineOperatingPolicy: { mode: "scheduled" },
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "MachineOperatingPolicyValidationError",
      }),
    );
  });

  it("does not invoke power mutations or change wake-alarm state while planning", async () => {
    const shutdownController: MachineShutdownController = {
      requestShutdown: vi.fn(),
    };
    const capabilities = createPowerManagement({
      clock: createClock(),
      machineShutdownController: shutdownController,
      mockWakeAlarmState: {
        initialWakeAlarm: {
          state: "scheduled",
          scheduledFor: "2026-08-01T06:00:00.000Z",
        },
      },
    });

    const before = await capabilities.getNextWakeAlarm.execute();
    const plan = capabilities.getMachinePowerPlan.execute();
    const after = await capabilities.getNextWakeAlarm.execute();

    expect(plan.expectation).toBe("operating");
    expect(after).toEqual(before);
    expect(shutdownController.requestShutdown).not.toHaveBeenCalled();
  });

  it("keeps direct occurrence execution separate from scheduler confirmation", async () => {
    const wakeAlarmController: WakeAlarmController = {
      schedule: vi.fn(),
      cancel: vi.fn(),
    };
    const shutdownController: MachineShutdownController = {
      requestShutdown: vi.fn(),
    };
    const capabilities = createPowerManagement({
      clock: {
        now: vi.fn(() => new Date("2026-08-03T21:00:00.000Z")),
      },
      wakeAlarmController,
      machineShutdownController: shutdownController,
      machineOperatingPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        weeklySchedule: {
          windows: [
            { dayOfWeek: "monday", start: "08:00", end: "18:00" },
            { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
          ],
        },
      },
    });

    await expect(
      capabilities.executeMachineShutdownOccurrence.executeAt(
        {
          operation: "shutdown",
          scheduledFor: "2026-08-03T21:00:00.000Z",
          wakeScheduledFor: "2026-08-04T12:00:00.000Z",
        },
        "2026-08-03T21:00:00.000Z",
      ),
    ).resolves.toMatchObject({
      outcome: "rejected",
      decision: {
        blockers: [{ area: "confirmation", code: "not_confirmed" }],
      },
    });
    expect(wakeAlarmController.schedule).not.toHaveBeenCalled();
    expect(shutdownController.requestShutdown).not.toHaveBeenCalled();
  });
});
