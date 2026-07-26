import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ControlledEnvironmentConfig {
  host: string;
  port: number;
  logLevel: "info";
  serviceAvailabilityReconciliationSchedulerCursorFilePath?: string;
  serviceAvailabilityReconciliationOccurrenceClaimFilePath?: string;
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
    createServiceManagement: vi.fn(),
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
  createApp: vi.fn(() => ({
    listen: vi.fn(() => ({
      once: vi.fn(),
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
    ServiceAvailabilityReconciliationSchedulerRuntime: class {},
  }),
);

vi.mock("../src/logging/logger.js", () => ({
  createLogger: vi.fn(() => ({})),
  logHttpServerStarted: vi.fn(),
  logUnexpectedStartupFailure: vi.fn(),
}));

describe("application persistence adapter selection", () => {
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
    controlled.createServiceManagement.mockReset();
    controlled.createServiceManagement.mockReturnValue({
      serviceAvailabilityReconciliationSchedulerLoop: {
        start: vi.fn(() => Promise.resolve(Object.freeze({ kind: "stopped" }))),
        stop: vi.fn(() => Promise.resolve(Object.freeze({ kind: "stopped" }))),
      },
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
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      {
        serviceAvailabilityReconciliationOccurrenceClaimStore:
          controlled.claimStores[0],
      },
    );
  });

  it("combines one exact adapter of each type in one composition override", async () => {
    const cursorPath = "/var/lib/atlas-manager/cursor.json";
    const claimPath = "/var/lib/atlas-manager/claims.json";
    controlled.config = {
      ...controlled.config,
      serviceAvailabilityReconciliationSchedulerCursorFilePath: cursorPath,
      serviceAvailabilityReconciliationOccurrenceClaimFilePath: claimPath,
    };

    await import("../src/main.js");

    expect(controlled.cursorPaths).toEqual([cursorPath]);
    expect(controlled.claimPaths).toEqual([claimPath]);
    expect(controlled.createServiceManagement).toHaveBeenCalledOnce();
    expect(controlled.createServiceManagement).toHaveBeenCalledWith(
      process.env,
      {
        serviceAvailabilityReconciliationSchedulerCursorStore:
          controlled.cursorStores[0],
        serviceAvailabilityReconciliationOccurrenceClaimStore:
          controlled.claimStores[0],
      },
    );
  });
});
