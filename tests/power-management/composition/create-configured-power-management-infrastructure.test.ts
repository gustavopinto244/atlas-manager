import { describe, expect, it, vi } from "vitest";

import {
  createConfiguredPowerManagementInfrastructure,
  PowerManagementInfrastructureError,
} from "../../../src/power-management/composition/create-configured-power-management-infrastructure.js";
import { createLinuxPowerHelperAdapters } from "../../../src/power-management/composition/create-linux-power-helper-adapters.js";
import { InMemoryLinuxPowerHelperTransport } from "../../../src/power-management/infrastructure/in-memory-linux-power-helper-transport.js";

describe("configured power-management infrastructure", () => {
  it("keeps the default mock backend without constructing Linux adapters", () => {
    const createAdapters = vi.fn(() => createLinuxPowerHelperAdapters());
    const infrastructure = createConfiguredPowerManagementInfrastructure(
      "mock",
      { createLinuxPowerHelperAdapters: createAdapters },
    );

    expect(infrastructure.backend).toBe("mock");
    expect(infrastructure.adapters).toEqual({});
    expect(createAdapters).not.toHaveBeenCalled();
    expect(Object.isFrozen(infrastructure)).toBe(true);
    expect(Object.isFrozen(infrastructure.adapters)).toBe(true);
  });

  it("creates one complete frozen Linux bundle for explicit selection", () => {
    const bundle = createLinuxPowerHelperAdapters({
      transport: new InMemoryLinuxPowerHelperTransport(),
    });
    const createAdapters = vi.fn(() => bundle);
    const infrastructure = createConfiguredPowerManagementInfrastructure(
      "linux_helper",
      { createLinuxPowerHelperAdapters: createAdapters },
    );

    expect(createAdapters).toHaveBeenCalledOnce();
    expect(infrastructure.backend).toBe("linux_helper");
    expect(infrastructure.adapters.rtcInformationReader).toBe(
      bundle.rtcInformationReader,
    );
    expect(infrastructure.adapters.wakeAlarmReader).toBe(
      bundle.wakeAlarmReader,
    );
    expect(infrastructure.adapters.wakeAlarmController).toBe(
      bundle.wakeAlarmController,
    );
    expect(infrastructure.adapters.machineShutdownController).toBe(
      bundle.machineShutdownController,
    );
    expect(Object.isFrozen(infrastructure)).toBe(true);
    expect(Object.isFrozen(infrastructure.adapters)).toBe(true);
  });

  it("fails closed for an incomplete adapter factory result", () => {
    const createAdapters = vi.fn(() => ({
      rtcInformationReader: { read: vi.fn() },
      wakeAlarmReader: { read: vi.fn() },
      wakeAlarmController: { schedule: vi.fn() },
      machineShutdownController: { requestShutdown: vi.fn() },
    }));

    expect(() =>
      createConfiguredPowerManagementInfrastructure("linux_helper", {
        createLinuxPowerHelperAdapters: createAdapters as never,
      }),
    ).toThrow(
      new PowerManagementInfrastructureError("invalid_linux_helper_adapters"),
    );
  });

  it("does not fall back when the Linux adapter factory throws", () => {
    const error = new Error("adapter construction failed");
    const createAdapters = vi.fn(() => {
      throw error;
    });

    expect(() =>
      createConfiguredPowerManagementInfrastructure("linux_helper", {
        createLinuxPowerHelperAdapters: createAdapters,
      }),
    ).toThrow(error);
  });
});
