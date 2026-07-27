import { describe, expect, it, vi } from "vitest";

import { ControlRegisteredService } from "../../../src/service-management/application/control-registered-service.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceController } from "../../../src/service-management/application/ports/service-controller.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  DispatchingServiceController,
  DispatchingServiceControllerError,
} from "../../../src/service-management/infrastructure/dispatching-service-controller.js";

const completedAt = "2026-07-25T12:00:00.000Z";

function createService(
  managementAdapter: "mock" | "pm2" | "docker",
  overrides: {
    readonly id?: string;
    readonly displayName?: string;
    readonly externalResourceId?: string;
    readonly supportedOperations?: readonly string[];
  } = {},
): RegisteredService {
  return RegisteredService.create({
    id: overrides.id ?? `${managementAdapter}-service`,
    displayName:
      overrides.displayName ?? `${managementAdapter.toUpperCase()} Service`,
    managementAdapter,
    externalResourceId:
      overrides.externalResourceId ?? `${managementAdapter}-external-resource`,
    supportedOperations: overrides.supportedOperations ?? [
      "readStatus",
      "start",
      "stop",
      "restart",
    ],
    availabilityPolicy: { mode: "manual" },
  });
}

function createController(): ServiceController & {
  readonly execute: ReturnType<typeof vi.fn<ServiceController["execute"]>>;
} {
  return {
    execute: vi.fn<ServiceController["execute"]>().mockResolvedValue(),
  };
}

describe("DispatchingServiceController", () => {
  it.each([
    ["mock", "start", "pm2", "docker"],
    ["mock", "stop", "pm2", "docker"],
    ["mock", "restart", "pm2", "docker"],
    ["pm2", "start", "mock", "docker"],
    ["pm2", "stop", "mock", "docker"],
    ["pm2", "restart", "mock", "docker"],
    ["docker", "start", "mock", "pm2"],
    ["docker", "stop", "mock", "pm2"],
    ["docker", "restart", "mock", "pm2"],
  ] as const)(
    "delegates a %s service %s only to its configured controller",
    async (
      managementAdapter,
      operation,
      nonSelectedAdapter1,
      nonSelectedAdapter2,
    ) => {
      const service = createService(managementAdapter);
      const mock = createController();
      const pm2 = createController();
      const docker = createController();
      const compose = createController();
      const dispatcher = new DispatchingServiceController({
        mock,
        pm2,
        docker,
        "docker-compose": compose,
      });
      const controllers = { mock, pm2, docker, "docker-compose": compose };
      const selectedController = controllers[managementAdapter];
      const nonSelectedController1 = controllers[nonSelectedAdapter1];
      const nonSelectedController2 = controllers[nonSelectedAdapter2];

      await expect(
        dispatcher.execute(service, operation),
      ).resolves.toBeUndefined();
      expect(selectedController.execute).toHaveBeenCalledExactlyOnceWith(
        service,
        operation,
      );
      expect(selectedController.execute.mock.calls[0]?.[0]).toBe(service);
      expect(selectedController.execute.mock.calls[0]?.[1]).toBe(operation);
      expect(nonSelectedController1.execute).not.toHaveBeenCalled();
      expect(nonSelectedController2.execute).not.toHaveBeenCalled();
    },
  );

  it("selects controllers only by management adapter", async () => {
    const firstMockService = createService("mock", {
      id: "pm2-named-service",
      displayName: "PM2 Named Service",
      externalResourceId: "pm2-external-resource",
      supportedOperations: ["readStatus", "restart"],
    });
    const secondMockService = createService("mock", {
      id: "another-service",
      displayName: "Another Display Name",
      externalResourceId: "another-external-resource",
      supportedOperations: ["readStatus"],
    });
    const pm2Service = createService("pm2", {
      id: "mock-named-service",
      displayName: "Mock Named Service",
      externalResourceId: "mock-external-resource",
      supportedOperations: ["readStatus", "start", "stop"],
    });
    const dockerService = createService("docker", {
      id: "docker-named-service",
      displayName: "Docker Named Service",
      externalResourceId: "docker-external-resource",
      supportedOperations: ["readStatus", "start", "stop", "restart"],
    });
    const mock = createController();
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    const dispatcher = new DispatchingServiceController({
      mock,
      pm2,
      docker,
      "docker-compose": compose,
    });

    await dispatcher.execute(firstMockService, "restart");
    await dispatcher.execute(secondMockService, "start");
    await dispatcher.execute(pm2Service, "stop");
    await dispatcher.execute(dockerService, "start");

    expect(mock.execute).toHaveBeenNthCalledWith(
      1,
      firstMockService,
      "restart",
    );
    expect(mock.execute).toHaveBeenNthCalledWith(2, secondMockService, "start");
    expect(pm2.execute).toHaveBeenCalledExactlyOnceWith(pm2Service, "stop");
    expect(docker.execute).toHaveBeenCalledExactlyOnceWith(
      dockerService,
      "start",
    );
  });

  it("does not enforce supported operations during delegation", async () => {
    const service = createService("mock", {
      supportedOperations: ["readStatus"],
    });
    const mock = createController();
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    const dispatcher = new DispatchingServiceController({
      mock,
      pm2,
      docker,
      "docker-compose": compose,
    });

    await expect(
      dispatcher.execute(service, "restart"),
    ).resolves.toBeUndefined();
    expect(mock.execute).toHaveBeenCalledExactlyOnceWith(service, "restart");
    expect(pm2.execute).not.toHaveBeenCalled();
    expect(docker.execute).not.toHaveBeenCalled();
  });

  it("resolves only after the selected controller resolves", async () => {
    let resolveSelected: (() => void) | undefined;
    const selectedExecution = new Promise<void>((resolve) => {
      resolveSelected = resolve;
    });
    const mock = createController();
    mock.execute.mockReturnValue(selectedExecution);
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    const dispatcher = new DispatchingServiceController({
      mock,
      pm2,
      docker,
      "docker-compose": compose,
    });
    let dispatcherResolved = false;

    const execution = dispatcher
      .execute(createService("mock"), "start")
      .then(() => {
        dispatcherResolved = true;
      });

    await Promise.resolve();
    expect(dispatcherResolved).toBe(false);

    resolveSelected?.();
    await execution;

    expect(dispatcherResolved).toBe(true);
  });

  it.each(["mock", "pm2", "docker"] as const)(
    "propagates a %s-controller failure unchanged without fallback",
    async (managementAdapter) => {
      const failure = Object.assign(new Error("Selected controller failure"), {
        code: "original_controller_error",
      });
      const mock = createController();
      const pm2 = createController();
      const docker = createController();
      const compose = createController();
      const selectedController =
        managementAdapter === "mock"
          ? mock
          : managementAdapter === "pm2"
            ? pm2
            : docker;
      const alternativeController1 =
        managementAdapter === "mock"
          ? pm2
          : managementAdapter === "pm2"
            ? mock
            : mock;
      const alternativeController2 =
        managementAdapter === "mock"
          ? docker
          : managementAdapter === "pm2"
            ? docker
            : pm2;
      selectedController.execute.mockRejectedValue(failure);
      const dispatcher = new DispatchingServiceController({
        mock,
        pm2,
        docker,
        "docker-compose": compose,
      });

      await expect(
        dispatcher.execute(createService(managementAdapter), "restart"),
      ).rejects.toBe(failure);
      expect(failure.code).toBe("original_controller_error");
      expect(failure.message).toBe("Selected controller failure");
      expect(failure).not.toHaveProperty("cause");
      expect(selectedController.execute).toHaveBeenCalledOnce();
      expect(alternativeController1.execute).not.toHaveBeenCalled();
      expect(alternativeController2.execute).not.toHaveBeenCalled();
    },
  );

  it("does not add service, operation, or infrastructure details to errors", async () => {
    const service = createService("pm2");
    const operation = "restart";
    const failure = new Error("Selected controller failure");
    const mock = createController();
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    pm2.execute.mockRejectedValue(failure);
    const dispatcher = new DispatchingServiceController({
      mock,
      pm2,
      docker,
      "docker-compose": compose,
    });

    try {
      await dispatcher.execute(service, operation);
      expect.unreachable("Expected selected controller failure");
    } catch (error) {
      expect(error).toBe(failure);

      const exposedError = `${String(error)} ${JSON.stringify(error)}`;

      expect(exposedError).not.toContain(service.id);
      expect(exposedError).not.toContain(service.externalResourceId);
      expect(exposedError).not.toContain(service.managementAdapter);
      expect(exposedError).not.toContain(operation);
      expect(exposedError).not.toContain("raw-pm2-output");
      expect(exposedError).not.toContain("pm2 start");
    }
  });

  it("takes an immutable snapshot of explicitly supplied controllers", async () => {
    const originalMock = createController();
    const replacementMock = createController();
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    const replacementCompose = createController();
    const dependencies = {
      mock: originalMock,
      pm2,
      docker,
      "docker-compose": compose,
    };
    const dispatcher = new DispatchingServiceController(dependencies);

    dependencies.mock = replacementMock;
    dependencies["docker-compose"] = replacementCompose;

    await dispatcher.execute(createService("mock"), "stop");
    expect(originalMock.execute).toHaveBeenCalledOnce();
    expect(replacementMock.execute).not.toHaveBeenCalled();
    expect(Object.isFrozen(dispatcher)).toBe(true);
    expect(dispatcher).not.toHaveProperty("register");
    expect(dispatcher).not.toHaveProperty("replace");
    expect(dispatcher).not.toHaveProperty("remove");
    expect(dispatcher).not.toHaveProperty("loadPlugin");
  });

  it.each([
    [undefined],
    [
      {
        mock: undefined,
        pm2: createController(),
        docker: createController(),
        "docker-compose": createController(),
      },
    ],
    [
      {
        mock: createController(),
        pm2: undefined,
        docker: createController(),
        "docker-compose": createController(),
      },
    ],
    [
      {
        mock: createController(),
        pm2: createController(),
        docker: undefined,
        "docker-compose": createController(),
      },
    ],
  ])(
    "rejects missing controller configuration without fallback",
    (dependencies) => {
      expect(
        () =>
          new DispatchingServiceController(
            dependencies as unknown as {
              readonly mock: ServiceController;
              readonly pm2: ServiceController;
              readonly docker: ServiceController;
              readonly "docker-compose": ServiceController;
            },
          ),
      ).toThrowError(
        expect.objectContaining({
          name: "DispatchingServiceControllerError",
          code: "service_controller_unavailable",
          message: "Service controller unavailable",
        }),
      );
    },
  );

  it("rejects an invalid runtime adapter without selecting a controller", async () => {
    const mock = createController();
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    const dispatcher = new DispatchingServiceController({
      mock,
      pm2,
      docker,
      "docker-compose": compose,
    });
    const service = createService("mock");
    const invalidService = {
      ...service,
      managementAdapter: "Mock",
    } as unknown as RegisteredService;

    await expect(
      dispatcher.execute(invalidService, "start"),
    ).rejects.toBeInstanceOf(DispatchingServiceControllerError);
    expect(mock.execute).not.toHaveBeenCalled();
    expect(pm2.execute).not.toHaveBeenCalled();
    expect(docker.execute).not.toHaveBeenCalled();
  });
});

describe("ControlRegisteredService with controller dispatcher", () => {
  it.each([
    ["mock", "start"],
    ["pm2", "restart"],
    ["docker", "stop"],
  ] as const)(
    "produces a complete result for a registered %s service",
    async (managementAdapter, operation) => {
      const service = createService(managementAdapter, {
        supportedOperations: ["readStatus", operation],
      });
      const findById = vi.fn().mockResolvedValue(service);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn(),
        findById,
      };
      const mock = createController();
      const pm2 = createController();
      const docker = createController();
      const compose = createController();
      const selectedController =
        managementAdapter === "mock"
          ? mock
          : managementAdapter === "pm2"
            ? pm2
            : docker;
      const alternativeController1 =
        managementAdapter === "mock"
          ? pm2
          : managementAdapter === "pm2"
            ? mock
            : mock;
      const alternativeController2 =
        managementAdapter === "mock"
          ? docker
          : managementAdapter === "pm2"
            ? docker
            : pm2;
      const dispatcher = new DispatchingServiceController({
        mock,
        pm2,
        docker,
        "docker-compose": compose,
      });
      const clock = { now: vi.fn(() => new Date(completedAt)) };
      const controlService = new ControlRegisteredService(
        catalog,
        dispatcher,
        clock,
      );

      await expect(
        controlService.execute(service.id, operation),
      ).resolves.toEqual({
        serviceId: service.id,
        operation,
        completedAt,
      });
      expect(findById).toHaveBeenCalledExactlyOnceWith(service.id);
      expect(selectedController.execute).toHaveBeenCalledExactlyOnceWith(
        service,
        operation,
      );
      expect(selectedController.execute.mock.calls[0]?.[0]).toBe(service);
      expect(alternativeController1.execute).not.toHaveBeenCalled();
      expect(alternativeController2.execute).not.toHaveBeenCalled();
      expect(findById.mock.invocationCallOrder[0]).toBeLessThan(
        selectedController.execute.mock.invocationCallOrder[0] ?? 0,
      );
      expect(
        selectedController.execute.mock.invocationCallOrder[0],
      ).toBeLessThan(clock.now.mock.invocationCallOrder[0] ?? 0);
      expect(clock.now).toHaveBeenCalledOnce();
    },
  );

  it("keeps unknown services outside the dispatcher", async () => {
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(null),
    };
    const mock = createController();
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    const dispatcher = new DispatchingServiceController({
      mock,
      pm2,
      docker,
      "docker-compose": compose,
    });
    const clock = { now: vi.fn() };
    const controlService = new ControlRegisteredService(
      catalog,
      dispatcher,
      clock,
    );

    await expect(
      controlService.execute("missing-service", "start"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "registered_service_not_found" }),
    );
    expect(mock.execute).not.toHaveBeenCalled();
    expect(pm2.execute).not.toHaveBeenCalled();
    expect(docker.execute).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("enforces supported operations before dispatch", async () => {
    const service = createService("pm2", {
      supportedOperations: ["readStatus"],
    });
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const mock = createController();
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    const dispatcher = new DispatchingServiceController({
      mock,
      pm2,
      docker,
      "docker-compose": compose,
    });
    const clock = { now: vi.fn() };
    const controlService = new ControlRegisteredService(
      catalog,
      dispatcher,
      clock,
    );

    await expect(controlService.execute(service.id, "stop")).rejects.toEqual(
      expect.objectContaining({ code: "service_operation_not_supported" }),
    );
    expect(mock.execute).not.toHaveBeenCalled();
    expect(pm2.execute).not.toHaveBeenCalled();
    expect(docker.execute).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("does not capture completion time after controller failure", async () => {
    const service = createService("pm2", {
      supportedOperations: ["readStatus", "restart"],
    });
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const failure = new Error("Selected controller failure");
    const mock = createController();
    const pm2 = createController();
    const docker = createController();
    const compose = createController();
    pm2.execute.mockRejectedValue(failure);
    const dispatcher = new DispatchingServiceController({
      mock,
      pm2,
      docker,
      "docker-compose": compose,
    });
    const clock = { now: vi.fn() };
    const controlService = new ControlRegisteredService(
      catalog,
      dispatcher,
      clock,
    );

    await expect(controlService.execute(service.id, "restart")).rejects.toBe(
      failure,
    );
    expect(clock.now).not.toHaveBeenCalled();
  });
});
