import { describe, expect, it, vi } from "vitest";

import { createAdministrativeRuntime } from "../../src/http/create-administrative-runtime.js";
import type { EnvironmentConfig } from "../../src/config/environment.js";
import { createLinuxPowerHelperAdapters } from "../../src/power-management/composition/create-linux-power-helper-adapters.js";
import { InMemoryLinuxPowerHelperTransport } from "../../src/power-management/infrastructure/in-memory-linux-power-helper-transport.js";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";

function shutdownConfig(): EnvironmentConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    logLevel: "info",
    powerManagementBackend: "mock",
    administrativeEventHistoryHttpEnabled: false,
    administrativeWakeAlarmHttpEnabled: false,
    administrativeShutdownHttpEnabled: true,
    administrativeEventHistoryFilePath: "/tmp/atlas-manager-events.jsonl",
    administrativeRoleAssignments: [
      {
        principal: { principalId: PRINCIPAL_ID },
        roles: ["administrator"],
      },
    ],
    cloudflareAccess: {
      teamName: "atlas",
      issuer: "https://atlas.cloudflareaccess.com",
      audience: "atlas-admin",
    },
    machineShutdownOccurrenceClaimFilePath:
      "/tmp/atlas-manager-shutdown-claims.json",
    machinePowerSchedulerCursorFilePath:
      "/tmp/atlas-manager-shutdown-cursor.json",
  };
}

describe("administrative shutdown runtime composition", () => {
  it("creates only the enabled shutdown surface with persistent power stores", () => {
    const createAdapters = vi.fn(() =>
      createLinuxPowerHelperAdapters({
        transport: new InMemoryLinuxPowerHelperTransport(),
      }),
    );
    const runtime = createAdministrativeRuntime(shutdownConfig(), undefined, {
      createLinuxPowerHelperAdapters: createAdapters,
    });

    expect(runtime.eventHistory).toBeUndefined();
    expect(runtime.wakeAlarm).toBeUndefined();
    expect(runtime.shutdown).toBeDefined();
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.shutdown)).toBe(true);
    expect(createAdapters).not.toHaveBeenCalled();
  });

  it("selects the complete Linux adapter bundle only when explicitly configured", () => {
    const createAdapters = vi.fn(() =>
      createLinuxPowerHelperAdapters({
        transport: new InMemoryLinuxPowerHelperTransport(),
      }),
    );
    const runtime = createAdministrativeRuntime(
      { ...shutdownConfig(), powerManagementBackend: "linux_helper" },
      undefined,
      { createLinuxPowerHelperAdapters: createAdapters },
    );

    expect(runtime.shutdown).toBeDefined();
    expect(createAdapters).toHaveBeenCalledOnce();
  });
});
