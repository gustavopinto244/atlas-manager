import { describe, expect, it, vi } from "vitest";

import { ControlRegisteredService } from "../../../src/service-management/application/control-registered-service.js";
import {
  ExecuteRegisteredServiceAvailabilityReconciliationOccurrence,
  type ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult,
} from "../../../src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceController } from "../../../src/service-management/application/ports/service-controller.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/plan-registered-service-availability-reconciliation.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  RegisteredServiceControlResult,
  type ServiceControlOperation,
} from "../../../src/service-management/domain/registered-service-control-result.js";
import {
  ServiceAvailabilityReconciliationOccurrence,
  type CreateServiceAvailabilityReconciliationOccurrenceInput,
} from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-reconciliation-occurrence-claim-store.js";

const scheduledFor = "2026-07-27T11:00:00.000Z";
const completedAt = "2026-07-27T11:00:01.000Z";

function createOccurrence(
  input: Partial<CreateServiceAvailabilityReconciliationOccurrenceInput> = {},
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId: "atlas-api",
    operation: "start",
    scheduledFor,
    ...input,
  });
}

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

function createClaimStore(
  result: "claimed" | "duplicate" = "claimed",
): ServiceAvailabilityReconciliationOccurrenceClaimStore & {
  readonly claim: ReturnType<
    typeof vi.fn<ServiceAvailabilityReconciliationOccurrenceClaimStore["claim"]>
  >;
} {
  return {
    claim: vi
      .fn<ServiceAvailabilityReconciliationOccurrenceClaimStore["claim"]>()
      .mockResolvedValue({ kind: result }),
  };
}

function createControlResult(
  operation: ServiceControlOperation,
  serviceId = "atlas-api",
): RegisteredServiceControlResult {
  return RegisteredServiceControlResult.create({
    serviceId,
    operation,
    completedAt,
  });
}

function expectFrozenResult(
  result: ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult,
  expectedKeys: readonly string[],
): void {
  expect(Object.keys(result)).toEqual(expectedKeys);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Reflect.set(result, "kind", "changed")).toBe(false);
  expect(Reflect.set(result, "occurrence", "private")).toBe(false);
  expect(Reflect.deleteProperty(result, "kind")).toBe(false);
}

function createService(
  supportedOperations: readonly ("readStatus" | "start" | "stop")[],
): RegisteredService {
  return RegisteredService.create({
    id: "atlas-api",
    displayName: "Atlas API",
    managementAdapter: "mock",
    externalResourceId: "private-atlas-api",
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

describe("ExecuteRegisteredServiceAvailabilityReconciliationOccurrence", () => {
  it("returns frozen none when planning requires no operation", async () => {
    const occurrence = createOccurrence();
    const planner = createPlanner();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockResolvedValue({ kind: "none" });
    const claimStore = createClaimStore();
    const control = createControl();
    const controlExecute = vi.spyOn(control, "execute");
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        control,
      );

    const result = await useCase.execute(occurrence);

    expect(plannerExecute).toHaveBeenCalledExactlyOnceWith(
      occurrence.serviceId,
    );
    expect(claimStore.claim).not.toHaveBeenCalled();
    expect(controlExecute).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "none" });
    expectFrozenResult(result, ["kind"]);
  });

  it.each([
    ["start", "stop"],
    ["stop", "start"],
  ] as const)(
    "returns none without claiming when occurrence %s differs from planned %s",
    async (occurrenceOperation, plannedOperation) => {
      const occurrence = createOccurrence({
        operation: occurrenceOperation,
      });
      const planner = createPlanner();
      vi.spyOn(planner, "execute").mockResolvedValue({
        kind: "execute",
        operation: plannedOperation,
      });
      const claimStore = createClaimStore();
      const control = createControl();
      const controlExecute = vi.spyOn(control, "execute");
      const useCase =
        new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
          planner,
          claimStore,
          control,
        );

      const result = await useCase.execute(occurrence);

      expect(result).toEqual({ kind: "none" });
      expect(claimStore.claim).not.toHaveBeenCalled();
      expect(controlExecute).not.toHaveBeenCalled();
      expectFrozenResult(result, ["kind"]);
    },
  );

  it.each(["start", "stop"] as const)(
    "executes a matching claimed %s occurrence in exact order",
    async (operation) => {
      const trace: string[] = [];
      const occurrence = createOccurrence({ operation });
      const planner = createPlanner();
      const planningExecute = vi
        .spyOn(planner, "execute")
        .mockImplementation(() => {
          trace.push("planning");
          return Promise.resolve({ kind: "execute", operation });
        });
      const claimStore = createClaimStore();
      claimStore.claim.mockImplementation(() => {
        trace.push("claim");
        return Promise.resolve({ kind: "claimed" });
      });
      const control = createControl();
      const controlResult = createControlResult(operation);
      const controlExecute = vi
        .spyOn(control, "execute")
        .mockImplementation(() => {
          trace.push("control");
          return Promise.resolve(controlResult);
        });
      const useCase =
        new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
          planner,
          claimStore,
          control,
        );

      const result = await useCase.execute(occurrence);

      expect(trace).toEqual(["planning", "claim", "control"]);
      expect(planningExecute).toHaveBeenCalledExactlyOnceWith(
        occurrence.serviceId,
      );
      expect(claimStore.claim).toHaveBeenCalledExactlyOnceWith(occurrence);
      expect(claimStore.claim.mock.calls[0]?.[0]).toBe(occurrence);
      expect(controlExecute).toHaveBeenCalledExactlyOnceWith(
        occurrence.serviceId,
        occurrence.operation,
      );
      expect(result).toEqual({ kind: "executed", controlResult });
      expectFrozenResult(result, ["kind", "controlResult"]);
      if (result.kind === "executed") {
        expect(result.controlResult).toBe(controlResult);
        expect(Reflect.set(result, "controlResult", {})).toBe(false);
      }
    },
  );

  it.each(["start", "stop"] as const)(
    "returns frozen duplicate for a matching duplicate %s occurrence",
    async (operation) => {
      const occurrence = createOccurrence({ operation });
      const planner = createPlanner();
      vi.spyOn(planner, "execute").mockResolvedValue({
        kind: "execute",
        operation,
      });
      const claimStore = createClaimStore("duplicate");
      const control = createControl();
      const controlExecute = vi.spyOn(control, "execute");
      const useCase =
        new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
          planner,
          claimStore,
          control,
        );

      const result = await useCase.execute(occurrence);

      expect(claimStore.claim).toHaveBeenCalledExactlyOnceWith(occurrence);
      expect(controlExecute).not.toHaveBeenCalled();
      expect(result).toEqual({ kind: "duplicate" });
      expectFrozenResult(result, ["kind"]);
    },
  );

  it("propagates planner failure before claim or control", async () => {
    const failure = new Error("planner unavailable");
    const planner = createPlanner();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockRejectedValue(failure);
    const claimStore = createClaimStore();
    const control = createControl();
    const controlExecute = vi.spyOn(control, "execute");
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        control,
      );

    await expect(useCase.execute(createOccurrence())).rejects.toBe(failure);
    expect(plannerExecute).toHaveBeenCalledOnce();
    expect(claimStore.claim).not.toHaveBeenCalled();
    expect(controlExecute).not.toHaveBeenCalled();
  });

  it("propagates claim-store failure before control without retry", async () => {
    const failure = new Error("claim store unavailable");
    const planner = createPlanner();
    vi.spyOn(planner, "execute").mockResolvedValue({
      kind: "execute",
      operation: "start",
    });
    const claimStore = createClaimStore();
    claimStore.claim.mockRejectedValue(failure);
    const control = createControl();
    const controlExecute = vi.spyOn(control, "execute");
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        control,
      );

    await expect(useCase.execute(createOccurrence())).rejects.toBe(failure);
    expect(claimStore.claim).toHaveBeenCalledOnce();
    expect(controlExecute).not.toHaveBeenCalled();
  });

  it("allows exactly one concurrent equivalent occurrence to reach control", async () => {
    const occurrences = Array.from({ length: 20 }, () => createOccurrence());
    const planner = createPlanner();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockResolvedValue({ kind: "execute", operation: "start" });
    const claimStore =
      new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
    const control = createControl();
    const controlResult = createControlResult("start");
    const controlExecute = vi
      .spyOn(control, "execute")
      .mockResolvedValue(controlResult);
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        control,
      );

    const results = await Promise.all(
      occurrences.map((occurrence) => useCase.execute(occurrence)),
    );

    expect(plannerExecute).toHaveBeenCalledTimes(occurrences.length);
    expect(controlExecute).toHaveBeenCalledExactlyOnceWith(
      "atlas-api",
      "start",
    );
    expect(results.filter(({ kind }) => kind === "executed")).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === "duplicate")).toHaveLength(
      occurrences.length - 1,
    );
  });

  it("keeps different service and instant occurrences independently executable", async () => {
    const occurrences = [
      createOccurrence(),
      createOccurrence({ serviceId: "atlas-worker" }),
      createOccurrence({
        scheduledFor: "2026-07-27T11:00:00.001Z",
      }),
    ];
    const planner = createPlanner();
    vi.spyOn(planner, "execute").mockResolvedValue({
      kind: "execute",
      operation: "start",
    });
    const claimStore =
      new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
    const control = createControl();
    const controlExecute = vi
      .spyOn(control, "execute")
      .mockImplementation((serviceId, operation) =>
        Promise.resolve(createControlResult(operation, serviceId)),
      );
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        control,
      );

    const results = await Promise.all(
      occurrences.map((occurrence) => useCase.execute(occurrence)),
    );

    expect(results.every(({ kind }) => kind === "executed")).toBe(true);
    expect(controlExecute).toHaveBeenCalledTimes(occurrences.length);
  });

  it("keeps start and stop occurrence claims independent", async () => {
    const claimStore =
      new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
    const control = createControl();
    const controlExecute = vi
      .spyOn(control, "execute")
      .mockImplementation((serviceId, operation) =>
        Promise.resolve(createControlResult(operation, serviceId)),
      );
    const startPlanner = createPlanner();
    vi.spyOn(startPlanner, "execute").mockResolvedValue({
      kind: "execute",
      operation: "start",
    });
    const stopPlanner = createPlanner();
    vi.spyOn(stopPlanner, "execute").mockResolvedValue({
      kind: "execute",
      operation: "stop",
    });
    const startUseCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        startPlanner,
        claimStore,
        control,
      );
    const stopUseCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        stopPlanner,
        claimStore,
        control,
      );

    const results = await Promise.all([
      startUseCase.execute(createOccurrence({ operation: "start" })),
      stopUseCase.execute(createOccurrence({ operation: "stop" })),
    ]);

    expect(results.every(({ kind }) => kind === "executed")).toBe(true);
    expect(controlExecute).toHaveBeenCalledTimes(2);
    expect(controlExecute).not.toHaveBeenCalledWith("atlas-api", "restart");
  });

  it.each(["start", "stop"] as const)(
    "leaves an unsupported claimed %s occurrence consumed",
    async (operation) => {
      const occurrence = createOccurrence({ operation });
      const service = createService(["readStatus"]);
      const controller = createController();
      const control = new ControlRegisteredService(
        createCatalog(vi.fn().mockResolvedValue(service)),
        controller,
        { now: vi.fn() },
      );
      const planner = createPlanner();
      vi.spyOn(planner, "execute").mockResolvedValue({
        kind: "execute",
        operation,
      });
      const claimStore =
        new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
      const useCase =
        new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
          planner,
          claimStore,
          control,
        );

      await expect(useCase.execute(occurrence)).rejects.toEqual(
        expect.objectContaining({
          name: "ControlRegisteredServiceError",
          code: "service_operation_not_supported",
        }),
      );
      await expect(useCase.execute(occurrence)).resolves.toEqual({
        kind: "duplicate",
      });
      expect(controller.execute).not.toHaveBeenCalled();
    },
  );

  it("keeps a claim consumed after controller failure", async () => {
    const occurrence = createOccurrence();
    const failure = new Error("controller unavailable");
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
    const claimStore =
      new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        control,
      );

    await expect(useCase.execute(occurrence)).rejects.toBe(failure);
    await expect(useCase.execute(occurrence)).resolves.toEqual({
      kind: "duplicate",
    });
    expect(controller.execute).toHaveBeenCalledOnce();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("keeps a claim consumed after completion-clock failure", async () => {
    const occurrence = createOccurrence();
    const failure = new Error("completion clock unavailable");
    const service = createService(["readStatus", "start"]);
    const controller = createController();
    const clock = {
      now: vi.fn(() => {
        throw failure;
      }),
    };
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
    const claimStore =
      new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        control,
      );

    await expect(useCase.execute(occurrence)).rejects.toBe(failure);
    await expect(useCase.execute(occurrence)).resolves.toEqual({
      kind: "duplicate",
    });
    expect(controller.execute).toHaveBeenCalledOnce();
    expect(clock.now).toHaveBeenCalledOnce();
  });

  it("does not recreate or mutate the occurrence or use current time directly", async () => {
    const source = {
      serviceId: "atlas-api",
      operation: "start",
      scheduledFor,
    };
    const occurrence =
      ServiceAvailabilityReconciliationOccurrence.create(source);
    const occurrenceSnapshot = { ...occurrence };
    const planner = createPlanner();
    vi.spyOn(planner, "execute").mockResolvedValue({
      kind: "execute",
      operation: "start",
    });
    const claimStore = createClaimStore();
    const control = createControl();
    vi.spyOn(control, "execute").mockResolvedValue(
      createControlResult("start"),
    );
    const occurrenceCreate = vi.spyOn(
      ServiceAvailabilityReconciliationOccurrence,
      "create",
    );
    const dateNow = vi.spyOn(Date, "now");
    const dateConstructor = vi.spyOn(globalThis, "Date");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        control,
      );

    await useCase.execute(occurrence);

    expect(occurrenceCreate).not.toHaveBeenCalled();
    expect(dateNow).not.toHaveBeenCalled();
    expect(dateConstructor).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(occurrence).toEqual(occurrenceSnapshot);
    expect(source).toEqual(occurrenceSnapshot);

    occurrenceCreate.mockRestore();
    dateNow.mockRestore();
    dateConstructor.mockRestore();
    setTimeoutSpy.mockRestore();
  });
});
