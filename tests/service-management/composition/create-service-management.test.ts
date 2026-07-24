import { describe, expect, it, vi } from "vitest";

import { ControlRegisteredService } from "../../../src/service-management/application/control-registered-service.js";
import { GetRegisteredServiceStatus } from "../../../src/service-management/application/get-registered-service-status.js";
import { ListRegisteredServices } from "../../../src/service-management/application/list-registered-services.js";
import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import {
  createServiceManagement,
  type ServiceManagementCompositionOverrides,
} from "../../../src/service-management/composition/create-service-management.js";
import type { MockServiceStatusConfiguration } from "../../../src/service-management/infrastructure/mock-service-status-reader.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import type { Pm2ServiceControlExecutor } from "../../../src/service-management/infrastructure/pm2-service-control-executor.js";

const firstTimestamp = "2026-07-25T12:00:00.000Z";
const secondTimestamp = "2026-07-25T12:01:00.000Z";

interface ConfiguredService {
  readonly id: string;
  readonly displayName: string;
  readonly managementAdapter: "mock" | "pm2";
  readonly externalResourceId: string;
  readonly supportedOperations: readonly string[];
}

function createConfiguredService(
  managementAdapter: "mock" | "pm2",
  overrides: Partial<ConfiguredService> = {},
): ConfiguredService {
  return {
    id: `${managementAdapter}-service`,
    displayName: `${managementAdapter.toUpperCase()} Service`,
    managementAdapter,
    externalResourceId: `${managementAdapter}-target`,
    supportedOperations: ["readStatus", "start", "stop", "restart"],
    ...overrides,
  };
}

function createEnvironment(
  services: readonly ConfiguredService[],
): Readonly<Record<string, string | undefined>> {
  return {
    REGISTERED_SERVICES_JSON: JSON.stringify(services),
  };
}

function createClock(...timestamps: readonly string[]): Clock & {
  readonly now: ReturnType<typeof vi.fn<Clock["now"]>>;
} {
  const now = vi.fn<Clock["now"]>();

  for (const timestamp of timestamps) {
    now.mockReturnValueOnce(new Date(timestamp));
  }

  return { now };
}

function createProcessListExecutor(output: string): Pm2ProcessListExecutor & {
  readonly execute: ReturnType<typeof vi.fn<Pm2ProcessListExecutor["execute"]>>;
} {
  return {
    execute: vi
      .fn<Pm2ProcessListExecutor["execute"]>()
      .mockResolvedValue(output),
  };
}

function createControlExecutor(): Pm2ServiceControlExecutor & {
  readonly execute: ReturnType<
    typeof vi.fn<Pm2ServiceControlExecutor["execute"]>
  >;
} {
  return {
    execute: vi.fn<Pm2ServiceControlExecutor["execute"]>().mockResolvedValue(),
  };
}

function createPm2Process(
  name = "pm2-target",
  processId = 42,
  status = "online",
): Record<string, unknown> {
  return {
    name,
    pm_id: processId,
    pm2_env: { status },
    pid: 8_421,
    environmentSecret: "private-environment-value",
  };
}

describe("createServiceManagement", () => {
  it("returns exactly the three frozen application capabilities", () => {
    const capabilities = createServiceManagement({});

    expect(capabilities.listRegisteredServices).toBeInstanceOf(
      ListRegisteredServices,
    );
    expect(capabilities.getRegisteredServiceStatus).toBeInstanceOf(
      GetRegisteredServiceStatus,
    );
    expect(capabilities.controlRegisteredService).toBeInstanceOf(
      ControlRegisteredService,
    );
    expect(Object.keys(capabilities)).toEqual([
      "listRegisteredServices",
      "getRegisteredServiceStatus",
      "controlRegisteredService",
    ]);
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities).not.toHaveProperty("catalog");
    expect(capabilities).not.toHaveProperty("statusReader");
    expect(capabilities).not.toHaveProperty("controller");
    expect(capabilities).not.toHaveProperty("processListExecutor");
    expect(capabilities).not.toHaveProperty("overrides");
    expect(capabilities).not.toHaveProperty("environment");
  });

  it("prevents capability replacement through the runtime bundle", () => {
    const capabilities = createServiceManagement({});

    expect(() => {
      (
        capabilities as {
          listRegisteredServices: ListRegisteredServices;
        }
      ).listRegisteredServices = new ListRegisteredServices({
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(null),
      });
    }).toThrow(TypeError);
  });

  it("uses an empty catalog when registered-service configuration is absent", async () => {
    const capabilities = createServiceManagement({});

    await expect(
      capabilities.listRegisteredServices.execute(),
    ).resolves.toEqual([]);
    await expect(
      capabilities.getRegisteredServiceStatus.execute("missing-service"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "registered_service_not_found" }),
    );
    await expect(
      capabilities.controlRegisteredService.execute("missing-service", "start"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "registered_service_not_found" }),
    );
  });

  it("lists configured mock and PM2 services in environment order", async () => {
    const services = [
      createConfiguredService("pm2", { id: "first-service" }),
      createConfiguredService("mock", { id: "second-service" }),
      createConfiguredService("pm2", {
        id: "third-service",
        externalResourceId: "third-target",
      }),
    ];
    const capabilities = createServiceManagement(createEnvironment(services));

    const listedServices = await capabilities.listRegisteredServices.execute();

    expect(listedServices.map((service) => service.id)).toEqual([
      "first-service",
      "second-service",
      "third-service",
    ]);
  });

  it.each([
    ["malformed configuration", { REGISTERED_SERVICES_JSON: "not-json" }],
    [
      "duplicate service IDs",
      createEnvironment([
        createConfiguredService("mock", { id: "duplicate-service" }),
        createConfiguredService("pm2", { id: "duplicate-service" }),
      ]),
    ],
    [
      "duplicate adapter-owned resources",
      createEnvironment([
        createConfiguredService("mock", {
          id: "first-service",
          externalResourceId: "duplicate-target",
        }),
        createConfiguredService("mock", {
          id: "second-service",
          externalResourceId: "duplicate-target",
        }),
      ]),
    ],
  ])("propagates safe catalog composition failure for %s", (_label, env) => {
    expect(() => createServiceManagement(env)).toThrowError(
      expect.objectContaining({
        name: "RegisteredServiceConfigurationError",
      }),
    );
  });

  it("shares the injected clock between status and control without calling it during composition", async () => {
    const service = createConfiguredService("mock");
    const clock = createClock(firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "running" },
      ],
    });

    expect(clock.now).not.toHaveBeenCalled();

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).resolves.toEqual({
      serviceId: service.id,
      state: "running",
      observedAt: firstTimestamp,
    });
    await expect(
      capabilities.controlRegisteredService.execute(service.id, "restart"),
    ).resolves.toEqual({
      serviceId: service.id,
      operation: "restart",
      completedAt: secondTimestamp,
    });
    expect(clock.now).toHaveBeenCalledTimes(2);
  });

  it("provides a lazy default system clock", async () => {
    const service = createConfiguredService("mock");
    const capabilities = createServiceManagement(createEnvironment([service]), {
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "stopped" },
      ],
    });

    const result = await capabilities.getRegisteredServiceStatus.execute(
      service.id,
    );

    expect(new Date(result.observedAt).toISOString()).toBe(result.observedAt);
  });

  it("does not call the clock after mock status failure", async () => {
    const service = createConfiguredService("mock");
    const clock = createClock(firstTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
    });

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).rejects.toEqual(
      expect.objectContaining({ code: "service_status_unavailable" }),
    );
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("accepts configured mock status and keeps mock control stateless", async () => {
    const service = createConfiguredService("mock");
    const clock = createClock(firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "running" },
      ],
    });

    await capabilities.controlRegisteredService.execute(service.id, "stop");

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).resolves.toEqual({
      serviceId: service.id,
      state: "running",
      observedAt: secondTimestamp,
    });
  });

  it.each([
    [
      "an invalid mock state",
      [{ externalResourceId: "mock-target", state: "starting" }],
      "invalid_mock_status_state",
    ],
    [
      "duplicate mock targets",
      [
        { externalResourceId: "mock-target", state: "running" },
        { externalResourceId: "mock-target", state: "stopped" },
      ],
      "duplicate_mock_status_target",
    ],
  ] as const)(
    "prevents composition for %s",
    (_description, mockStatusConfiguration, expectedCode) => {
      expect(() =>
        createServiceManagement({}, { mockStatusConfiguration }),
      ).toThrowError(expect.objectContaining({ code: expectedCode }));
    },
  );

  it("routes mock capabilities without invoking PM2 executors", async () => {
    const service = createConfiguredService("mock");
    const processListExecutor = createProcessListExecutor(
      JSON.stringify([createPm2Process()]),
    );
    const controlExecutor = createControlExecutor();
    const clock = createClock(firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: service.externalResourceId, state: "failed" },
      ],
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    await capabilities.getRegisteredServiceStatus.execute(service.id);
    await capabilities.controlRegisteredService.execute(service.id, "start");

    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it("shares the supplied PM2 process-list executor across status and control", async () => {
    const service = createConfiguredService("pm2");
    const processListExecutor = createProcessListExecutor(
      JSON.stringify([
        createPm2Process(service.externalResourceId, 42, "online"),
      ]),
    );
    const controlExecutor = createControlExecutor();
    const clock = createClock(firstTimestamp, secondTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();

    await expect(
      capabilities.getRegisteredServiceStatus.execute(service.id),
    ).resolves.toEqual({
      serviceId: service.id,
      state: "running",
      observedAt: firstTimestamp,
    });
    expect(processListExecutor.execute).toHaveBeenCalledTimes(1);
    expect(controlExecutor.execute).not.toHaveBeenCalled();

    await expect(
      capabilities.controlRegisteredService.execute(service.id, "restart"),
    ).resolves.toEqual({
      serviceId: service.id,
      operation: "restart",
      completedAt: secondTimestamp,
    });
    expect(processListExecutor.execute).toHaveBeenCalledTimes(2);
    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "restart",
      42,
    );
    expect(
      processListExecutor.execute.mock.invocationCallOrder[1],
    ).toBeLessThan(controlExecutor.execute.mock.invocationCallOrder[0] ?? 0);
  });

  it("prevents clock access and fallback after PM2 controller failure", async () => {
    const service = createConfiguredService("pm2");
    const processListExecutor = createProcessListExecutor("[]");
    const controlExecutor = createControlExecutor();
    const clock = createClock(firstTimestamp);
    const capabilities = createServiceManagement(createEnvironment([service]), {
      clock,
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    await expect(
      capabilities.controlRegisteredService.execute(service.id, "stop"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "pm2_control_target_not_found" }),
    );
    expect(controlExecutor.execute).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("enforces supported operations before PM2 execution", async () => {
    const service = createConfiguredService("pm2", {
      supportedOperations: ["readStatus"],
    });
    const processListExecutor = createProcessListExecutor(
      JSON.stringify([createPm2Process(service.externalResourceId)]),
    );
    const controlExecutor = createControlExecutor();
    const capabilities = createServiceManagement(createEnvironment([service]), {
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    await expect(
      capabilities.controlRegisteredService.execute(service.id, "start"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "service_operation_not_supported" }),
    );
    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it("captures override dependencies and configuration during composition", async () => {
    const mockService = createConfiguredService("mock");
    const pm2Service = createConfiguredService("pm2");
    const originalClock = createClock(firstTimestamp, secondTimestamp);
    const replacementClock = createClock(secondTimestamp);
    const originalProcessListExecutor = createProcessListExecutor(
      JSON.stringify([
        createPm2Process(pm2Service.externalResourceId, 42, "online"),
      ]),
    );
    const replacementProcessListExecutor = createProcessListExecutor("[]");
    const originalControlExecutor = createControlExecutor();
    const replacementControlExecutor = createControlExecutor();
    const mockStatusConfiguration: MockServiceStatusConfiguration[] = [
      { externalResourceId: mockService.externalResourceId, state: "unknown" },
    ];
    const overrides: {
      clock: Clock;
      mockStatusConfiguration: readonly MockServiceStatusConfiguration[];
      pm2ProcessListExecutor: Pm2ProcessListExecutor;
      pm2ControlExecutor: Pm2ServiceControlExecutor;
    } = {
      clock: originalClock,
      mockStatusConfiguration,
      pm2ProcessListExecutor: originalProcessListExecutor,
      pm2ControlExecutor: originalControlExecutor,
    };
    const capabilities = createServiceManagement(
      createEnvironment([mockService, pm2Service]),
      overrides,
    );

    overrides.clock = replacementClock;
    overrides.mockStatusConfiguration = [];
    overrides.pm2ProcessListExecutor = replacementProcessListExecutor;
    overrides.pm2ControlExecutor = replacementControlExecutor;
    mockStatusConfiguration[0] = {
      externalResourceId: mockService.externalResourceId,
      state: "failed",
    };

    await expect(
      capabilities.getRegisteredServiceStatus.execute(mockService.id),
    ).resolves.toEqual({
      serviceId: mockService.id,
      state: "unknown",
      observedAt: firstTimestamp,
    });
    await expect(
      capabilities.controlRegisteredService.execute(pm2Service.id, "restart"),
    ).resolves.toEqual({
      serviceId: pm2Service.id,
      operation: "restart",
      completedAt: secondTimestamp,
    });
    expect(originalProcessListExecutor.execute).toHaveBeenCalledOnce();
    expect(originalControlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "restart",
      42,
    );
    expect(replacementClock.now).not.toHaveBeenCalled();
    expect(replacementProcessListExecutor.execute).not.toHaveBeenCalled();
    expect(replacementControlExecutor.execute).not.toHaveBeenCalled();
  });

  it("does not mutate environment or overrides during composition", () => {
    const environment = createEnvironment([createConfiguredService("mock")]);
    const clock = createClock(firstTimestamp);
    const processListExecutor = createProcessListExecutor("[]");
    const controlExecutor = createControlExecutor();
    const overrides: ServiceManagementCompositionOverrides = {
      clock,
      mockStatusConfiguration: [],
      pm2ProcessListExecutor: processListExecutor,
      pm2ControlExecutor: controlExecutor,
    };
    const environmentSnapshot = { ...environment };
    const overrideEntries = Object.entries(overrides);

    createServiceManagement(environment, overrides);

    expect(environment).toEqual(environmentSnapshot);
    expect(Object.entries(overrides)).toEqual(overrideEntries);
    expect(clock.now).not.toHaveBeenCalled();
    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it("introduces no timer or signal-listener side effect during composition", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      createServiceManagement({});

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
