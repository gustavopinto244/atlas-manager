/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import type { MachineShutdownController } from "../../../src/power-management/application/ports/machine-shutdown-controller.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import type { RtcInformationReader } from "../../../src/power-management/application/ports/rtc-information-reader.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";
import { createRtcInformation } from "../../../src/power-management/domain/rtc-information.js";

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
    const requestMachineShutdown = capabilities.requestMachineShutdown;
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities.getRtcInformation).toBe(getRtcInformation);
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
    const capabilities = createPowerManagement({
      clock,
      rtcInformationReader: reader,
      machineShutdownController: controller,
    });

    await expect(capabilities.getRtcInformation.execute()).resolves.toBe(
      readerResult,
    );
    await expect(capabilities.requestMachineShutdown.execute()).resolves.toBe(
      shutdownResult,
    );
    expect(clock.now).toHaveBeenCalledTimes(2);
    expect(reader.read).toHaveBeenCalledWith(NOW);
    expect(controller.requestShutdown).toHaveBeenCalledWith(NOW);
  });

  it("constructs deterministic mock defaults without privileged dependencies", async () => {
    const capabilities = createPowerManagement({ clock: createClock() });

    await expect(capabilities.getRtcInformation.execute()).resolves.toEqual({
      observedAt: NOW,
      rtcTime: "2026-01-01T00:00:00.000Z",
      wakeAlarm: { state: "unsupported" },
    });
    await expect(
      capabilities.requestMachineShutdown.execute(),
    ).resolves.toEqual({
      operation: "shutdown",
      requestedAt: NOW,
      outcome: "simulated",
    });
  });
});
