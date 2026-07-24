import { describe, expect, it, vi } from "vitest";

import {
  ControlRegisteredService,
  ControlRegisteredServiceError,
} from "../../../src/service-management/application/control-registered-service.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceController } from "../../../src/service-management/application/ports/service-controller.js";
import { RegisteredServiceNotFoundError } from "../../../src/service-management/application/registered-service-not-found-error.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { ServiceControlOperation } from "../../../src/service-management/domain/registered-service-control-result.js";

const completedAt = "2026-07-24T12:00:00.000Z";

function createService(
  supportedOperations: readonly ("readStatus" | "start" | "stop" | "restart")[],
): RegisteredService {
  return RegisteredService.create({
    id: "task-manager",
    displayName: "Task Manager",
    managementAdapter: "mock",
    externalResourceId: "private-mock-target",
    supportedOperations,
  });
}

function createCatalog(
  findById: RegisteredServiceCatalog["findById"],
): RegisteredServiceCatalog {
  return {
    list: vi.fn(),
    findById,
  };
}

function createController(): ServiceController & {
  readonly execute: ReturnType<typeof vi.fn<ServiceController["execute"]>>;
} {
  return {
    execute: vi.fn<ServiceController["execute"]>().mockResolvedValue(),
  };
}

describe("ControlRegisteredService", () => {
  it.each(["start", "stop", "restart"] as const)(
    "executes an explicitly permitted %s operation",
    async (operation) => {
      const service = createService(["readStatus", operation]);
      const findById = vi.fn().mockResolvedValue(service);
      const catalog = createCatalog(findById);
      const controller = createController();
      const clock = { now: vi.fn(() => new Date(completedAt)) };
      const controlService = new ControlRegisteredService(
        catalog,
        controller,
        clock,
      );

      await expect(
        controlService.execute("task-manager", operation),
      ).resolves.toEqual({
        serviceId: "task-manager",
        operation,
        completedAt,
      });
      expect(findById).toHaveBeenCalledExactlyOnceWith("task-manager");
      expect(controller.execute).toHaveBeenCalledExactlyOnceWith(
        service,
        operation,
      );
      expect(controller.execute.mock.calls[0]?.[0]).toBe(service);
      expect(clock.now).toHaveBeenCalledOnce();
      expect(controller.execute.mock.invocationCallOrder[0]).toBeLessThan(
        clock.now.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );

  it.each([
    "unknown-service",
    "TASK-MANAGER",
    " task-manager",
    "task-manager ",
  ])(
    "rejects the unresolved stable ID %s before control or clock access",
    async (serviceId) => {
      const findById = vi.fn().mockResolvedValue(null);
      const controller = createController();
      const clock = { now: vi.fn() };
      const controlService = new ControlRegisteredService(
        createCatalog(findById),
        controller,
        clock,
      );

      await expect(controlService.execute(serviceId, "start")).rejects.toEqual(
        expect.objectContaining({
          name: "RegisteredServiceNotFoundError",
          code: "registered_service_not_found",
        }),
      );
      expect(findById).toHaveBeenCalledExactlyOnceWith(serviceId);
      expect(controller.execute).not.toHaveBeenCalled();
      expect(clock.now).not.toHaveBeenCalled();
    },
  );

  it.each(["start", "stop", "restart"] as const)(
    "rejects %s when the service permits only status reads",
    async (operation) => {
      await expectUnsupportedOperation(
        createService(["readStatus"]),
        operation,
      );
    },
  );

  it.each(["start", "stop"] as const)(
    "rejects %s when the service permits only restart control",
    async (operation) => {
      await expectUnsupportedOperation(
        createService(["readStatus", "restart"]),
        operation,
      );
    },
  );

  it("propagates catalog failures unchanged", async () => {
    const failure = new Error("Catalog unavailable");
    const controller = createController();
    const clock = { now: vi.fn() };
    const controlService = new ControlRegisteredService(
      createCatalog(vi.fn().mockRejectedValue(failure)),
      controller,
      clock,
    );

    await expect(
      controlService.execute("task-manager", "restart"),
    ).rejects.toBe(failure);
    expect(controller.execute).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("propagates controller failures unchanged without creating a result", async () => {
    const service = createService(["readStatus", "restart"]);
    const failure = new Error("Controller unavailable");
    const controller = createController();
    controller.execute.mockRejectedValue(failure);
    const clock = { now: vi.fn() };
    const controlService = new ControlRegisteredService(
      createCatalog(vi.fn().mockResolvedValue(service)),
      controller,
      clock,
    );

    await expect(
      controlService.execute("task-manager", "restart"),
    ).rejects.toBe(failure);
    expect(controller.execute).toHaveBeenCalledExactlyOnceWith(
      service,
      "restart",
    );
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("does not add service or operation details to errors", async () => {
    const service = createService(["readStatus"]);
    const rejectedOperation = "restart";
    const controlService = new ControlRegisteredService(
      createCatalog(vi.fn().mockResolvedValue(service)),
      createController(),
      { now: vi.fn() },
    );

    try {
      await controlService.execute(service.id, rejectedOperation);
      expect.unreachable("Expected unsupported operation");
    } catch (error) {
      expect(error).toBeInstanceOf(ControlRegisteredServiceError);

      const exposedError = `${String(error)} ${JSON.stringify(error)}`;

      expect(exposedError).not.toContain(service.id);
      expect(exposedError).not.toContain(service.externalResourceId);
      expect(exposedError).not.toContain(service.managementAdapter);
      expect(exposedError).not.toContain(rejectedOperation);
      expect(exposedError).not.toContain("readStatus");
    }
  });

  it("does not interpret the stable ID as the infrastructure target", async () => {
    const service = createService(["readStatus", "start"]);
    const controller = createController();
    const controlService = new ControlRegisteredService(
      createCatalog(vi.fn().mockResolvedValue(service)),
      controller,
      { now: vi.fn(() => new Date(completedAt)) },
    );

    await controlService.execute(service.id, "start");

    expect(service.id).not.toBe(service.externalResourceId);
    expect(controller.execute).toHaveBeenCalledWith(service, "start");
  });

  it("uses the shared not-found contract without exposing the rejected ID", async () => {
    const rejectedServiceId = "credential-secret-service";
    const controlService = new ControlRegisteredService(
      createCatalog(vi.fn().mockResolvedValue(null)),
      createController(),
      { now: vi.fn() },
    );

    try {
      await controlService.execute(rejectedServiceId, "stop");
      expect.unreachable("Expected unknown service");
    } catch (error) {
      expect(error).toBeInstanceOf(RegisteredServiceNotFoundError);
      expect(String(error)).not.toContain(rejectedServiceId);
    }
  });
});

async function expectUnsupportedOperation(
  service: RegisteredService,
  operation: ServiceControlOperation,
): Promise<void> {
  const controller = createController();
  const clock = { now: vi.fn() };
  const controlService = new ControlRegisteredService(
    createCatalog(vi.fn().mockResolvedValue(service)),
    controller,
    clock,
  );

  await expect(controlService.execute(service.id, operation)).rejects.toEqual(
    expect.objectContaining({
      name: "ControlRegisteredServiceError",
      code: "service_operation_not_supported",
      message: "Service operation not supported",
    }),
  );
  expect(controller.execute).not.toHaveBeenCalled();
  expect(clock.now).not.toHaveBeenCalled();
}
