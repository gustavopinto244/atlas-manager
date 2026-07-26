import { describe, expect, it, vi } from "vitest";

import { ControlRegisteredService } from "../../../src/service-management/application/control-registered-service.js";
import { ExecuteRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/execute-registered-service-availability-reconciliation.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceController } from "../../../src/service-management/application/ports/service-controller.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/plan-registered-service-availability-reconciliation.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { RegisteredServiceControlResult } from "../../../src/service-management/domain/registered-service-control-result.js";
import type { ServiceAvailabilityReconciliationDecision } from "../../../src/service-management/domain/service-availability-reconciliation-decision.js";

const completedAt = "2026-07-25T12:00:00.000Z";

function createPlanner(): PlanRegisteredServiceAvailabilityReconciliation {
  return new PlanRegisteredServiceAvailabilityReconciliation(
    {
      list: vi.fn(),
      findById: vi.fn(),
    },
    {
      findByServiceId: vi.fn(),
      save: vi.fn(),
      removeByServiceId: vi.fn(),
      removeByServiceIdIfMatches: vi.fn(),
    },
    { read: vi.fn() },
    { now: vi.fn() },
  );
}

function createControl(): ControlRegisteredService {
  return new ControlRegisteredService(
    {
      list: vi.fn(),
      findById: vi.fn(),
    },
    { execute: vi.fn() },
    { now: vi.fn() },
  );
}

function createControlResult(
  operation: "start" | "stop",
): RegisteredServiceControlResult {
  return RegisteredServiceControlResult.create({
    serviceId: "task-manager",
    operation,
    completedAt,
  });
}

function createService(
  supportedOperations: readonly ("readStatus" | "start" | "stop")[],
): RegisteredService {
  return RegisteredService.create({
    id: "task-manager",
    displayName: "Task Manager",
    managementAdapter: "mock",
    externalResourceId: "private-mock-target",
    supportedOperations,
    availabilityPolicy: { mode: "always" },
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

describe("ExecuteRegisteredServiceAvailabilityReconciliation", () => {
  it("returns an explicit frozen none result without calling control", async () => {
    const planner = createPlanner();
    const control = createControl();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockResolvedValue({ kind: "none" });
    const controlExecute = vi.spyOn(control, "execute");
    const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
      planner,
      control,
    );

    const result = await useCase.execute(" Task-Manager ");

    expect(plannerExecute).toHaveBeenCalledExactlyOnceWith(" Task-Manager ");
    expect(controlExecute).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "none" });
    expect(Object.keys(result)).toEqual(["kind"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, "kind", "executed")).toBe(false);
    expect(
      Reflect.set(result, "controlResult", createControlResult("start")),
    ).toBe(false);
    expect(Reflect.deleteProperty(result, "kind")).toBe(false);
  });

  it.each(["start", "stop"] as const)(
    "delegates an execute %s decision and preserves control-result identity",
    async (operation) => {
      const trace: string[] = [];
      const planner = createPlanner();
      const control = createControl();
      const decision = Object.freeze({ kind: "execute", operation } as const);
      const controlResult = createControlResult(operation);
      const plannerExecute = vi
        .spyOn(planner, "execute")
        .mockImplementation(() => {
          trace.push("planning");
          return Promise.resolve(decision);
        });
      const controlExecute = vi
        .spyOn(control, "execute")
        .mockImplementation(() => {
          trace.push("control");
          return Promise.resolve(controlResult);
        });
      const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
        planner,
        control,
      );

      const result = await useCase.execute("Task-Manager ");

      expect(trace).toEqual(["planning", "control"]);
      expect(plannerExecute).toHaveBeenCalledExactlyOnceWith("Task-Manager ");
      expect(controlExecute).toHaveBeenCalledExactlyOnceWith(
        "Task-Manager ",
        operation,
      );
      expect(result).toEqual({ kind: "executed", controlResult });
      expect(Object.keys(result)).toEqual(["kind", "controlResult"]);
      expect(Object.isFrozen(result)).toBe(true);

      if (result.kind === "executed") {
        expect(result.controlResult).toBe(controlResult);
        expect(Reflect.set(result, "controlResult", {})).toBe(false);
      }

      expect(Reflect.set(result, "metadata", "unexpected")).toBe(false);
      expect(Reflect.deleteProperty(result, "kind")).toBe(false);
      expect(decision).toEqual({ kind: "execute", operation });
    },
  );

  it("propagates planner failures unchanged and stops before control", async () => {
    const failure = new Error("planning dependency unavailable");
    const planner = createPlanner();
    const control = createControl();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockRejectedValue(failure);
    const controlExecute = vi.spyOn(control, "execute");
    const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
      planner,
      control,
    );

    await expect(useCase.execute("task-manager")).rejects.toBe(failure);
    expect(plannerExecute).toHaveBeenCalledOnce();
    expect(controlExecute).not.toHaveBeenCalled();
  });

  it("propagates control failures unchanged without retrying", async () => {
    const failure = new Error("controlled operation unavailable");
    const planner = createPlanner();
    const control = createControl();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockResolvedValue({ kind: "execute", operation: "start" });
    const controlExecute = vi
      .spyOn(control, "execute")
      .mockRejectedValue(failure);
    const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
      planner,
      control,
    );

    await expect(useCase.execute("task-manager")).rejects.toBe(failure);
    expect(plannerExecute).toHaveBeenCalledOnce();
    expect(controlExecute).toHaveBeenCalledExactlyOnceWith(
      "task-manager",
      "start",
    );
  });

  it.each(["start", "stop"] as const)(
    "leaves unsupported %s enforcement to the existing control use case",
    async (operation) => {
      const service = createService(["readStatus"]);
      const controller = createController();
      const clock = { now: vi.fn() };
      const control = new ControlRegisteredService(
        createCatalog(vi.fn().mockResolvedValue(service)),
        controller,
        clock,
      );
      const planner = createPlanner();
      vi.spyOn(planner, "execute").mockResolvedValue({
        kind: "execute",
        operation,
      });
      const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
        planner,
        control,
      );

      await expect(useCase.execute(service.id)).rejects.toEqual(
        expect.objectContaining({
          name: "ControlRegisteredServiceError",
          code: "service_operation_not_supported",
        }),
      );
      expect(controller.execute).not.toHaveBeenCalled();
      expect(clock.now).not.toHaveBeenCalled();
    },
  );

  it("propagates controller failure without reading the completion clock", async () => {
    const failure = new Error("controller failed");
    const service = createService(["readStatus", "start"]);
    const controller = createController();
    controller.execute.mockRejectedValue(failure);
    const clock = { now: vi.fn() };
    const control = new ControlRegisteredService(
      createCatalog(vi.fn().mockResolvedValue(service)),
      controller,
      clock,
    );
    const planner = createPlanner();
    vi.spyOn(planner, "execute").mockResolvedValue({
      kind: "execute",
      operation: "start",
    });
    const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
      planner,
      control,
    );

    await expect(useCase.execute(service.id)).rejects.toBe(failure);
    expect(controller.execute).toHaveBeenCalledOnce();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("propagates completion-clock failures without repeating control", async () => {
    const failure = new Error("control clock failed");
    const service = createService(["readStatus", "stop"]);
    const controller = createController();
    const control = new ControlRegisteredService(
      createCatalog(vi.fn().mockResolvedValue(service)),
      controller,
      {
        now: vi.fn(() => {
          throw failure;
        }),
      },
    );
    const planner = createPlanner();
    vi.spyOn(planner, "execute").mockResolvedValue({
      kind: "execute",
      operation: "stop",
    });
    const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
      planner,
      control,
    );

    await expect(useCase.execute(service.id)).rejects.toBe(failure);
    expect(controller.execute).toHaveBeenCalledExactlyOnceWith(service, "stop");
  });

  it("allows repeated explicit executions without silent deduplication", async () => {
    const planner = createPlanner();
    const control = createControl();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockResolvedValue({ kind: "execute", operation: "start" });
    const controlExecute = vi
      .spyOn(control, "execute")
      .mockResolvedValue(createControlResult("start"));
    const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
      planner,
      control,
    );

    await useCase.execute("task-manager");
    await useCase.execute("task-manager");

    expect(plannerExecute).toHaveBeenCalledTimes(2);
    expect(controlExecute).toHaveBeenCalledTimes(2);
    expect(controlExecute).not.toHaveBeenCalledWith("task-manager", "restart");
  });

  it.each([
    { kind: "none" },
    { kind: "execute", operation: "start" },
    { kind: "execute", operation: "stop" },
  ] as const satisfies readonly ServiceAvailabilityReconciliationDecision[])(
    "never requests restart for the canonical decision $kind",
    async (decision) => {
      const planner = createPlanner();
      const control = createControl();
      vi.spyOn(planner, "execute").mockResolvedValue(decision);
      const controlExecute = vi
        .spyOn(control, "execute")
        .mockResolvedValue(createControlResult("start"));
      const useCase = new ExecuteRegisteredServiceAvailabilityReconciliation(
        planner,
        control,
      );

      await useCase.execute("task-manager");

      expect(controlExecute).not.toHaveBeenCalledWith(
        "task-manager",
        "restart",
      );
    },
  );
});
