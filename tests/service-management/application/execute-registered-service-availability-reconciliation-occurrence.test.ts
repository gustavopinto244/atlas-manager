import { describe, expect, it, vi } from "vitest";

import type { OrchestrateRegisteredServiceControl } from "../../../src/service-management/application/orchestrate-registered-service-control.js";
import {
  ExecuteRegisteredServiceAvailabilityReconciliationOccurrence,
  type ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult,
} from "../../../src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.js";
import type { ServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/plan-registered-service-availability-reconciliation.js";
import type { OrchestrationResult } from "../../../src/service-management/domain/orchestration-plan.js";
import {
  ServiceAvailabilityReconciliationOccurrence,
  type CreateServiceAvailabilityReconciliationOccurrenceInput,
} from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-reconciliation-occurrence-claim-store.js";

const scheduledFor = "2026-07-27T11:00:00.000Z";

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

function createOrchestrationResult(
  operation: "start" | "stop" | "restart" = "start",
): OrchestrationResult {
  return Object.freeze({
    targetServiceId: "atlas-api",
    requestedOperation: operation,
    startedAt: "2026-07-27T11:00:00.000Z",
    completedAt: "2026-07-27T11:00:01.000Z",
    steps: Object.freeze([]),
    successful: true,
  });
}

function createOrchestrate(): OrchestrateRegisteredServiceControl & {
  readonly execute: ReturnType<
    typeof vi.fn<OrchestrateRegisteredServiceControl["execute"]>
  >;
} {
  return {
    execute: vi
      .fn<OrchestrateRegisteredServiceControl["execute"]>()
      .mockResolvedValue(createOrchestrationResult()),
  } as unknown as OrchestrateRegisteredServiceControl & {
    readonly execute: ReturnType<
      typeof vi.fn<OrchestrateRegisteredServiceControl["execute"]>
    >;
  };
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
    pruneCompletedThrough: vi.fn(),
  };
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

describe("ExecuteRegisteredServiceAvailabilityReconciliationOccurrence", () => {
  it("returns frozen none when planning requires no operation", async () => {
    const occurrence = createOccurrence();
    const planner = createPlanner();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockResolvedValue({ kind: "none" });
    const claimStore = createClaimStore();
    const orchestrate = createOrchestrate();
    const orchestrateExecute = vi.spyOn(orchestrate, "execute");
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        orchestrate,
      );

    const result = await useCase.execute(occurrence);

    expect(plannerExecute).toHaveBeenCalledExactlyOnceWith(
      occurrence.serviceId,
    );
    expect(claimStore.claim).not.toHaveBeenCalled();
    expect(orchestrateExecute).not.toHaveBeenCalled();
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
      const orchestrate = createOrchestrate();
      const orchestrateExecute = vi.spyOn(orchestrate, "execute");
      const useCase =
        new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
          planner,
          claimStore,
          orchestrate,
        );

      const result = await useCase.execute(occurrence);

      expect(result).toEqual({ kind: "none" });
      expect(claimStore.claim).not.toHaveBeenCalled();
      expect(orchestrateExecute).not.toHaveBeenCalled();
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
          return Promise.resolve({
            kind: "execute",
            operation,
          } as const);
        });
      const claimStore = createClaimStore();
      claimStore.claim.mockImplementation(() => {
        trace.push("claim");
        return Promise.resolve({ kind: "claimed" });
      });
      const orchestrate = createOrchestrate();
      const orchestrationResult = createOrchestrationResult(operation);
      const orchestrateExecute = vi
        .spyOn(orchestrate, "execute")
        .mockImplementation(() => {
          trace.push("orchestrate");
          return Promise.resolve(orchestrationResult);
        });
      const useCase =
        new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
          planner,
          claimStore,
          orchestrate,
        );

      const result = await useCase.execute(occurrence);

      expect(trace).toEqual(["planning", "claim", "orchestrate"]);
      expect(planningExecute).toHaveBeenCalledExactlyOnceWith(
        occurrence.serviceId,
      );
      expect(claimStore.claim).toHaveBeenCalledExactlyOnceWith(occurrence);
      expect(claimStore.claim.mock.calls[0]?.[0]).toBe(occurrence);
      expect(orchestrateExecute).toHaveBeenCalledExactlyOnceWith(
        occurrence.serviceId,
        occurrence.operation,
        "scheduled",
      );
      expect(result).toEqual({
        kind: "executed",
        orchestrationResult,
      });
      expectFrozenResult(result, ["kind", "orchestrationResult"]);
      if (result.kind === "executed") {
        expect(result.orchestrationResult).toBe(orchestrationResult);
        expect(Reflect.set(result, "orchestrationResult", {})).toBe(false);
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
      const orchestrate = createOrchestrate();
      const orchestrateExecute = vi.spyOn(orchestrate, "execute");
      const useCase =
        new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
          planner,
          claimStore,
          orchestrate,
        );

      const result = await useCase.execute(occurrence);

      expect(claimStore.claim).toHaveBeenCalledExactlyOnceWith(occurrence);
      expect(orchestrateExecute).not.toHaveBeenCalled();
      expect(result).toEqual({ kind: "duplicate" });
      expectFrozenResult(result, ["kind"]);
    },
  );

  it("propagates planner failure before claim or orchestrate", async () => {
    const failure = new Error("planner unavailable");
    const planner = createPlanner();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockRejectedValue(failure);
    const claimStore = createClaimStore();
    const orchestrate = createOrchestrate();
    const orchestrateExecute = vi.spyOn(orchestrate, "execute");
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        orchestrate,
      );

    await expect(useCase.execute(createOccurrence())).rejects.toBe(failure);
    expect(plannerExecute).toHaveBeenCalledOnce();
    expect(claimStore.claim).not.toHaveBeenCalled();
    expect(orchestrateExecute).not.toHaveBeenCalled();
  });

  it("propagates claim-store failure before orchestrate without retry", async () => {
    const failure = new Error("claim store unavailable");
    const planner = createPlanner();
    vi.spyOn(planner, "execute").mockResolvedValue({
      kind: "execute",
      operation: "start",
    });
    const claimStore = createClaimStore();
    claimStore.claim.mockRejectedValue(failure);
    const orchestrate = createOrchestrate();
    const orchestrateExecute = vi.spyOn(orchestrate, "execute");
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        orchestrate,
      );

    await expect(useCase.execute(createOccurrence())).rejects.toBe(failure);
    expect(claimStore.claim).toHaveBeenCalledOnce();
    expect(orchestrateExecute).not.toHaveBeenCalled();
  });

  it("allows exactly one concurrent equivalent occurrence to reach orchestrate", async () => {
    const occurrences = Array.from({ length: 20 }, () => createOccurrence());
    const planner = createPlanner();
    const plannerExecute = vi
      .spyOn(planner, "execute")
      .mockResolvedValue({ kind: "execute", operation: "start" });
    const claimStore =
      new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
    const orchestrate = createOrchestrate();
    const orchestrationResult = createOrchestrationResult();
    const orchestrateExecute = vi
      .spyOn(orchestrate, "execute")
      .mockResolvedValue(orchestrationResult);
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        orchestrate,
      );

    const results = await Promise.all(
      occurrences.map((occurrence) => useCase.execute(occurrence)),
    );

    expect(plannerExecute).toHaveBeenCalledTimes(occurrences.length);
    expect(orchestrateExecute).toHaveBeenCalledExactlyOnceWith(
      "atlas-api",
      "start",
      "scheduled",
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
    const orchestrate = createOrchestrate();
    const orchestrateExecute = vi
      .spyOn(orchestrate, "execute")
      .mockImplementation((_serviceId, operation) =>
        Promise.resolve(createOrchestrationResult(operation)),
      );
    const useCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        planner,
        claimStore,
        orchestrate,
      );

    const results = await Promise.all(
      occurrences.map((occurrence) => useCase.execute(occurrence)),
    );

    expect(results.every(({ kind }) => kind === "executed")).toBe(true);
    expect(orchestrateExecute).toHaveBeenCalledTimes(occurrences.length);
  });

  it("keeps start and stop occurrence claims independent", async () => {
    const claimStore =
      new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
    const orchestrate = createOrchestrate();
    const orchestrateExecute = vi
      .spyOn(orchestrate, "execute")
      .mockImplementation((_serviceId, operation) =>
        Promise.resolve(createOrchestrationResult(operation)),
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
        orchestrate,
      );
    const stopUseCase =
      new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
        stopPlanner,
        claimStore,
        orchestrate,
      );

    const results = await Promise.all([
      startUseCase.execute(createOccurrence({ operation: "start" })),
      stopUseCase.execute(createOccurrence({ operation: "stop" })),
    ]);

    expect(results.every(({ kind }) => kind === "executed")).toBe(true);
    expect(orchestrateExecute).toHaveBeenCalledTimes(2);
    expect(orchestrateExecute).not.toHaveBeenCalledWith("atlas-api", "restart");
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
    const orchestrate = createOrchestrate();
    vi.spyOn(orchestrate, "execute").mockResolvedValue(
      createOrchestrationResult("start"),
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
        orchestrate,
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
