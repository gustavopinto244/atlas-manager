import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../../src/config/environment.js";
import { createRegisteredServiceCatalogFromEnvironment } from "../../src/service-management/infrastructure/environment-registered-service-catalog.js";

const mockOnlyEnvironment = {
  HOST: "127.0.0.1",
  PORT: "3000",
  LOG_LEVEL: "info",
  POWER_MANAGEMENT_BACKEND: "mock",
  MACHINE_POWER_EFFECTS_ACTIVATION: "disabled",
  MACHINE_POWER_SCHEDULER_ENABLED: "false",
  MACHINE_OPERATING_POLICY: '{"mode":"always_on"}',
  REGISTERED_SERVICES_JSON: "[]",
  ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED: "false",
  ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED: "false",
  ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED: "false",
} as const;

describe("canonical mock-only runtime profile", () => {
  it("is accepted by the real application parser", () => {
    const configuration = parseEnvironment(mockOnlyEnvironment);

    expect(configuration.host).toBe("127.0.0.1");
    expect(configuration.port).toBe(3000);
    expect(configuration.powerManagementBackend).toBe("mock");
    expect(configuration.machinePowerEffectsActivation).toEqual({
      kind: "disabled",
    });
    expect(configuration.machinePowerSchedulerEnabled).toBe(false);
    expect(configuration.machineOperatingPolicy).toEqual({ mode: "always_on" });
    expect(configuration.administrativeWakeAlarmHttpEnabled).toBe(false);
    expect(configuration.administrativeShutdownHttpEnabled).toBe(false);
    expect(configuration.administrativeEventHistoryHttpEnabled).toBe(false);
  });

  it("provides an empty service catalog without creating a mutation target", async () => {
    const catalog =
      createRegisteredServiceCatalogFromEnvironment(mockOnlyEnvironment);
    expect(await catalog.list()).toEqual([]);
  });
});
