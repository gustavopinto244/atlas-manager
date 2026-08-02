import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AdministrativePrincipal } from "../src/access-control/domain/administrative-principal.js";
import type { AdministrativeRole } from "../src/access-control/domain/administrative-role.js";

interface ControlledEnvironmentConfig {
  host: string;
  port: number;
  logLevel: "info";
  serviceAvailabilityReconciliationSchedulerCursorFilePath?: string;
  serviceAvailabilityReconciliationOccurrenceClaimFilePath?: string;
  serviceAvailabilityOverrideFilePath?: string;
  administrativeEventHistoryHttpEnabled?: boolean;
  administrativeWakeAlarmHttpEnabled?: boolean;
  administrativeShutdownHttpEnabled?: boolean;
  administrativeEventHistoryFilePath?: string;
  machinePowerSchedulerEnabled?: boolean;
  machinePowerEffectsActivation?: Readonly<
    | { kind: "disabled" }
    | { kind: "linux_helper"; expectedHelperSha256: string }
  >;
  machinePowerSchedulerCursorFilePath?: string;
  machineShutdownOccurrenceClaimFilePath?: string;
  administrativeRoleAssignments?: readonly {
    principal: AdministrativePrincipal;
    roles: readonly AdministrativeRole[];
  }[];
  cloudflareAccess?: Readonly<{
    teamName: string;
    issuer: string;
    audience: string;
  }>;
}

const controlled = vi.hoisted(() => {
  const config: ControlledEnvironmentConfig = {
    host: "127.0.0.1",
    port: 3000,
    logLevel: "info",
  };

  return {
    config,
    cursorStores: [] as object[],
    cursorPaths: [] as string[],
    claimStores: [] as object[],
    claimPaths: [] as string[],
    overrideStores: [] as object[],
    overridePaths: [] as string[],
    createServiceManagement: vi.fn(),
    admitConfiguredMachinePowerEffects: vi.fn(() => ({ kind: "disabled" })),
    createApp: vi.fn(),
    createConfiguredPowerManagementRuntime: vi.fn(),
    machineSchedulerLoops: [] as object[],
    machineSchedulerRuntimeStarts: 0,
    serverListeners: new Map<string, () => void>(),
  };
});

vi.mock("../src/config/environment.js", () => ({
  parseEnvironment: vi.fn(() => controlled.config),
  formatEnvironmentValidationError: vi.fn(() => undefined),
}));

vi.mock("../src/server-health/application/get-server-health.js", () => ({
  GetServerHealth: class {},
}));

vi.mock(
  "../src/server-health/infrastructure/linux-coretemp-cpu-temperature-reader.js",
  () => ({
    LinuxCoretempCpuTemperatureReader: class {},
  }),
);

vi.mock(
  "../src/server-health/infrastructure/node-server-health-reader.js",
  () => ({
    NodeServerHealthReader: class {},
    createNodeServerHealthReaderDependencies: vi.fn(() => ({})),
  }),
);

vi.mock(
  "../src/service-management/infrastructure/file-service-availability-override-store.js",
  () => ({
    FileServiceAvailabilityOverrideStore: class {
      public constructor(filePath: string) {
        controlled.overridePaths.push(filePath);
        controlled.overrideStores.push(this);
      }
    },
  }),
);

vi.mock(
  "../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js",
  () => ({
    FileServiceAvailabilityReconciliationSchedulerCursorStore: class {
      public constructor(filePath: string) {
        controlled.cursorPaths.push(filePath);
        controlled.cursorStores.push(this);
      }
    },
  }),
);

vi.mock(
  "../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js",
  () => ({
    FileServiceAvailabilityReconciliationOccurrenceClaimStore: class {
      public constructor(filePath: string) {
        controlled.claimPaths.push(filePath);
        controlled.claimStores.push(this);
      }
    },
  }),
);

vi.mock(
  "../src/service-management/composition/create-service-management.js",
  () => ({
    createServiceManagement: controlled.createServiceManagement,
  }),
);

vi.mock("../src/http/create-app.js", () => ({
  createApp: controlled.createApp.mockImplementation(() => ({
    listen: vi.fn(() => ({
      once: vi.fn((event: string, listener: () => void) => {
        controlled.serverListeners.set(event, listener);
      }),
      close: vi.fn(),
    })),
  })),
}));

vi.mock("../src/lifecycle/graceful-shutdown.js", () => ({
  createGracefulShutdown: vi.fn(() => vi.fn(() => Promise.resolve())),
  registerShutdownSignals: vi.fn(),
}));

vi.mock(
  "../src/lifecycle/service-availability-reconciliation-scheduler-runtime.js",
  () => ({
    ServiceAvailabilityReconciliationSchedulerRuntime: class {
      public start = vi.fn(() => Promise.resolve({ kind: "stopped" }));
    },
  }),
);

vi.mock(
  "../src/power-management/composition/create-configured-power-management-runtime.js",
  () => ({
    createConfiguredPowerManagementRuntime:
      controlled.createConfiguredPowerManagementRuntime.mockImplementation(
        () => ({ runMachinePowerSchedulerTick: { execute: vi.fn() } }),
      ),
  }),
);

vi.mock(
  "../src/power-management/composition/admit-configured-machine-power-effects.js",
  () => ({
    admitConfiguredMachinePowerEffects:
      controlled.admitConfiguredMachinePowerEffects,
  }),
);

vi.mock(
  "../src/power-management/application/machine-power-scheduler-loop.js",
  () => ({
    MachinePowerSchedulerLoop: class {
      public constructor() {
        controlled.machineSchedulerLoops.push(this);
      }

      public start = vi.fn(() => Promise.resolve({ kind: "stopped" }));

      public stop = vi.fn(() => Promise.resolve({ kind: "stopped" }));
    },
  }),
);

vi.mock("../src/lifecycle/machine-power-scheduler-runtime.js", () => ({
  MachinePowerSchedulerRuntime: class {
    public start = vi.fn(() => {
      controlled.machineSchedulerRuntimeStarts += 1;
      return Promise.resolve({ kind: "stopped" });
    });
  },
}));

vi.mock("../src/logging/logger.js", () => ({
  createLogger: vi.fn(() => ({})),
  logHttpServerStarted: vi.fn(),
  logMachinePowerEffectsActivationAdmitted: vi.fn(),
  logMachinePowerEffectsActivationBlocked: vi.fn(),
  logMachinePowerEffectsActivationDisabled: vi.fn(),
  logUnexpectedStartupFailure: vi.fn(),
}));

describe("application persistence adapter selection", () => {
  afterAll(() => {
    for (const modulePath of [
      "../src/config/environment.js",
      "../src/server-health/application/get-server-health.js",
      "../src/server-health/infrastructure/linux-coretemp-cpu-temperature-reader.js",
      "../src/server-health/infrastructure/node-server-health-reader.js",
      "../src/service-management/infrastructure/file-service-availability-override-store.js",
      "../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js",
      "../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js",
      "../src/service-management/composition/create-service-management.js",
      "../src/http/create-app.js",
      "../src/lifecycle/graceful-shutdown.js",
      "../src/lifecycle/service-availability-reconciliation-scheduler-runtime.js",
      "../src/power-management/composition/create-configured-power-management-runtime.js",
      "../src/power-management/application/machine-power-scheduler-loop.js",
      "../src/lifecycle/machine-power-scheduler-runtime.js",
      "../src/logging/logger.js",
    ])
      vi.doUnmock(modulePath);
    vi.resetModules();
  });

  beforeEach(() => {
    controlled.config = {
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
    };
    controlled.cursorStores.length = 0;
    controlled.cursorPaths.length = 0;
    controlled.claimStores.length = 0;
    controlled.claimPaths.length = 0;
    controlled.overrideStores.length = 0;
    controlled.overridePaths.length = 0;
    controlled.createConfiguredPowerManagementRuntime.mockReset();
    controlled.createConfiguredPowerManagementRuntime.mockImplementation(
      () => ({ runMachinePowerSchedulerTick: { execute: vi.fn() } }),
    );
    controlled.machineSchedulerLoops.length = 0;
    controlled.machineSchedulerRuntimeStarts = 0;
    controlled.serverListeners.clear();
    controlled.createApp.mockReset();
    controlled.createApp.mockImplementation(() => ({
      listen: vi.fn(() => ({
        once: vi.fn((event: string, listener: () => void) => {
          controlled.serverListeners.set(event, listener);
        }),
        close: vi.fn(),
      })),
    }));
    controlled.createServiceManagement.mockReset();
    controlled.createServiceManagement.mockReturnValue({
      serviceAvailabilityReconciliationSchedulerLoop: {
        start: vi.fn(() => Promise.resolve(Object.freeze({ kind: "stopped" }))),
        stop: vi.fn(() => Promise.resolve(Object.freeze({ kind: "stopped" }))),
      },
    });
    controlled.admitConfiguredMachinePowerEffects.mockReset();
    controlled.admitConfiguredMachinePowerEffects.mockReturnValue({
      kind: "disabled",
    });
    vi.resetModules();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("uses composition defaults when neither persistence path is configured", async () => {
    await import("../src/main.js");

    expect(controlled.cursorStores).toEqual([]);
    expect(controlled.claimStores).toEqual([]);
    expect(controlled.overrideStores).toEqual([]);
    expect(controlled.createServiceManagement).toHaveBeenCalledOnce();
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      undefined,
    );
  });

  it("selects only the file-backed scheduler cursor store when configured", async () => {
    const cursorPath = "/var/lib/atlas-manager/cursor.json";
    controlled.config = {
      ...controlled.config,
      serviceAvailabilityReconciliationSchedulerCursorFilePath: cursorPath,
    };

    await import("../src/main.js");

    expect(controlled.cursorPaths).toEqual([cursorPath]);
    expect(controlled.claimStores).toEqual([]);
    expect(controlled.overrideStores).toEqual([]);
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      {
        serviceAvailabilityReconciliationSchedulerCursorStore:
          controlled.cursorStores[0],
      },
    );
  });

  it("selects only the exact file-backed occurrence claim store when configured", async () => {
    const claimPath = "/var/lib/atlas-manager/claims.json";
    controlled.config = {
      ...controlled.config,
      serviceAvailabilityReconciliationOccurrenceClaimFilePath: claimPath,
    };

    await import("../src/main.js");

    expect(controlled.cursorStores).toEqual([]);
    expect(controlled.claimPaths).toEqual([claimPath]);
    expect(controlled.overrideStores).toEqual([]);
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      {
        serviceAvailabilityReconciliationOccurrenceClaimStore:
          controlled.claimStores[0],
      },
    );
  });

  it("selects only the exact file-backed availability override store when configured", async () => {
    const overridePath = "/var/lib/atlas-manager/overrides.json";
    controlled.config = {
      ...controlled.config,
      serviceAvailabilityOverrideFilePath: overridePath,
    };

    await import("../src/main.js");

    expect(controlled.cursorStores).toEqual([]);
    expect(controlled.claimStores).toEqual([]);
    expect(controlled.overridePaths).toEqual([overridePath]);
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      {
        serviceAvailabilityOverrideStore: controlled.overrideStores[0],
      },
    );
  });

  it("combines cursor and availability override stores independently", async () => {
    const cursorPath = "/var/lib/atlas-manager/cursor.json";
    const overridePath = "/var/lib/atlas-manager/overrides.json";
    controlled.config = {
      ...controlled.config,
      serviceAvailabilityReconciliationSchedulerCursorFilePath: cursorPath,
      serviceAvailabilityOverrideFilePath: overridePath,
    };

    await import("../src/main.js");

    expect(controlled.cursorPaths).toEqual([cursorPath]);
    expect(controlled.claimStores).toEqual([]);
    expect(controlled.overridePaths).toEqual([overridePath]);
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      {
        serviceAvailabilityReconciliationSchedulerCursorStore:
          controlled.cursorStores[0],
        serviceAvailabilityOverrideStore: controlled.overrideStores[0],
      },
    );
  });

  it("combines occurrence claim and availability override stores independently", async () => {
    const claimPath = "/var/lib/atlas-manager/claims.json";
    const overridePath = "/var/lib/atlas-manager/overrides.json";
    controlled.config = {
      ...controlled.config,
      serviceAvailabilityReconciliationOccurrenceClaimFilePath: claimPath,
      serviceAvailabilityOverrideFilePath: overridePath,
    };

    await import("../src/main.js");

    expect(controlled.cursorStores).toEqual([]);
    expect(controlled.claimPaths).toEqual([claimPath]);
    expect(controlled.overridePaths).toEqual([overridePath]);
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      {
        serviceAvailabilityReconciliationOccurrenceClaimStore:
          controlled.claimStores[0],
        serviceAvailabilityOverrideStore: controlled.overrideStores[0],
      },
    );
  });

  it("combines one exact adapter of all three types in one composition override", async () => {
    const cursorPath = "/var/lib/atlas-manager/cursor.json";
    const claimPath = "/var/lib/atlas-manager/claims.json";
    const overridePath = "/var/lib/atlas-manager/overrides.json";
    controlled.config = {
      ...controlled.config,
      serviceAvailabilityReconciliationSchedulerCursorFilePath: cursorPath,
      serviceAvailabilityReconciliationOccurrenceClaimFilePath: claimPath,
      serviceAvailabilityOverrideFilePath: overridePath,
    };

    await import("../src/main.js");

    expect(controlled.cursorPaths).toEqual([cursorPath]);
    expect(controlled.claimPaths).toEqual([claimPath]);
    expect(controlled.overridePaths).toEqual([overridePath]);
    expect(controlled.createServiceManagement).toHaveBeenCalledOnce();
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      {
        serviceAvailabilityReconciliationSchedulerCursorStore:
          controlled.cursorStores[0],
        serviceAvailabilityReconciliationOccurrenceClaimStore:
          controlled.claimStores[0],
        serviceAvailabilityOverrideStore: controlled.overrideStores[0],
      },
    );
  });

  it("constructs the protected route only for complete explicit activation", async () => {
    const principalId = "00000000-0000-4000-8000-000000000001";
    controlled.config = {
      ...controlled.config,
      administrativeEventHistoryHttpEnabled: true,
      administrativeEventHistoryFilePath:
        "/tmp/atlas-manager-administrative-events.jsonl",
      administrativeRoleAssignments: [
        {
          principal: { principalId },
          roles: ["auditor"],
        },
      ],
      cloudflareAccess: {
        teamName: "atlas",
        issuer: "https://atlas.cloudflareaccess.com",
        audience: "atlas-admin",
      },
    };

    await import("../src/main.js");

    expect(controlled.createApp).toHaveBeenCalledOnce();
    const dependencies = controlled.createApp.mock.calls[0]?.[0] as {
      administrativeEventHistory?: object;
    };
    expect(dependencies.administrativeEventHistory).toBeDefined();
  });

  it("does not construct or start the machine-power scheduler by default", async () => {
    await import("../src/main.js");

    expect(controlled.machineSchedulerLoops).toHaveLength(0);
    expect(controlled.machineSchedulerRuntimeStarts).toBe(0);
  });

  it("starts the enabled machine-power scheduler only after HTTP listening", async () => {
    controlled.config = {
      ...controlled.config,
      machinePowerSchedulerEnabled: true,
      machinePowerSchedulerCursorFilePath:
        "/var/lib/atlas-manager/power-cursor.json",
      machineShutdownOccurrenceClaimFilePath:
        "/var/lib/atlas-manager/power-claims.json",
      administrativeEventHistoryFilePath: "/var/lib/atlas-manager/events.jsonl",
    };

    await import("../src/main.js");

    expect(
      controlled.createConfiguredPowerManagementRuntime,
    ).toHaveBeenCalledOnce();
    expect(controlled.machineSchedulerLoops).toHaveLength(1);
    expect(controlled.machineSchedulerRuntimeStarts).toBe(0);

    controlled.serverListeners.get("listening")?.();
    expect(controlled.machineSchedulerRuntimeStarts).toBe(1);
  });

  it("blocks startup before HTTP composition when activation admission fails", async () => {
    controlled.admitConfiguredMachinePowerEffects.mockImplementation(() => {
      throw new Error("bounded admission failure");
    });

    await import("../src/main.js");

    expect(controlled.createServiceManagement).not.toHaveBeenCalled();
    expect(
      controlled.createConfiguredPowerManagementRuntime,
    ).not.toHaveBeenCalled();
    expect(controlled.createApp).not.toHaveBeenCalled();
    expect(controlled.machineSchedulerLoops).toHaveLength(0);
    expect(controlled.machineSchedulerRuntimeStarts).toBe(0);
    expect(process.exitCode).toBe(1);
  });
});
