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
    const requestMachineShutdown = capabilities.requestMachineShutdown;
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities.getRtcInformation).toBe(getRtcInformation);
    expect(capabilities.getNextWakeAlarm).toBe(getNextWakeAlarm);
    expect(capabilities.scheduleWakeAlarm).toBe(scheduleWakeAlarm);
    expect(capabilities.cancelWakeAlarm).toBe(cancelWakeAlarm);
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
});
