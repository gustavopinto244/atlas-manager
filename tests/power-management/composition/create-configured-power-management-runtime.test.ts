import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "../../../src/config/environment.js";
import { createEventHistory } from "../../../src/event-history/composition/create-event-history.js";
import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import { createConfiguredPowerManagementRuntime } from "../../../src/power-management/composition/create-configured-power-management-runtime.js";
import { createLinuxPowerHelperAdapters } from "../../../src/power-management/composition/create-linux-power-helper-adapters.js";
import { InMemoryLinuxPowerHelperTransport } from "../../../src/power-management/infrastructure/in-memory-linux-power-helper-transport.js";

describe("configured power-management runtime", () => {
  it("selects one complete Linux bundle and passes the immutable policy once", () => {
    const config = parseEnvironment({
      POWER_MANAGEMENT_BACKEND: "linux_helper",
      MACHINE_OPERATING_POLICY: JSON.stringify({ mode: "manual" }),
    });
    const eventHistory = createEventHistory();
    const createAdapters = vi.fn(() =>
      createLinuxPowerHelperAdapters({
        transport: new InMemoryLinuxPowerHelperTransport(),
      }),
    );
    const createCapabilities = vi.fn(createPowerManagement);

    const capabilities = createConfiguredPowerManagementRuntime(
      config,
      undefined,
      eventHistory,
      {
        createLinuxPowerHelperAdapters: createAdapters,
        createPowerManagement: createCapabilities,
      },
    );

    expect(capabilities).toBeDefined();
    expect(createAdapters).toHaveBeenCalledOnce();
    expect(createCapabilities).toHaveBeenCalledOnce();
    const overrides = createCapabilities.mock.calls[0]?.[0];
    expect(overrides?.machineOperatingPolicy).toBe(
      config.machineOperatingPolicy,
    );
    expect(overrides?.rtcInformationReader).toBeDefined();
    expect(overrides?.wakeAlarmReader).toBeDefined();
    expect(overrides?.wakeAlarmController).toBeDefined();
    expect(overrides?.machineShutdownController).toBeDefined();
  });

  it("keeps mock composition free of Linux adapter construction", () => {
    const config = parseEnvironment({});
    const createAdapters = vi.fn();

    createConfiguredPowerManagementRuntime(
      config,
      undefined,
      createEventHistory(),
      { createLinuxPowerHelperAdapters: createAdapters },
    );

    expect(createAdapters).not.toHaveBeenCalled();
  });
});
