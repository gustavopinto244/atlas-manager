import { describe, expect, it, vi } from "vitest";

import { ExecuteRegisteredServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.js";
import { GenerateRegisteredServiceAvailabilityReconciliationOccurrences } from "../../../src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.js";
import { ListRegisteredServices } from "../../../src/service-management/application/list-registered-services.js";
import type { OrchestrateRegisteredServiceControl } from "../../../src/service-management/application/orchestrate-registered-service-control.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../../../src/service-management/application/plan-registered-service-availability-reconciliation.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import { RunServiceAvailabilityReconciliationTick } from "../../../src/service-management/application/run-service-availability-reconciliation-tick.js";
import { createDependencyGraph } from "../../../src/service-management/domain/dependency-graph.js";
import type { RegisteredServiceDependencyGraph } from "../../../src/service-management/domain/dependency-graph.js";
import type { OrchestrationResult } from "../../../src/service-management/domain/orchestration-plan.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";

function createService(
  id: string,
  dependencies: readonly string[] = [],
): RegisteredService {
  return RegisteredService.create({
    id,
    displayName: id,
    managementAdapter: "mock",
    externalResourceId: `${id}-target`,
    supportedOperations: ["readStatus", "start", "stop"],
    availabilityPolicy: { mode: "manual" },
    dependencies,
  });
}

function createOccurrence(
  serviceId: string,
  operation: "start" | "stop",
  scheduledFor: string,
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId,
    operation,
    scheduledFor,
  });
}

function createGraph(): RegisteredServiceDependencyGraph {
  return createDependencyGraph([]);
}

function createOrchestrationResult(
  operation: "start" | "stop" = "start",
): OrchestrationResult {
  return Object.freeze({
    targetServiceId: "atlas-api",
    requestedOperation: operation,
    startedAt: "2026-07-27T12:00:00.000Z",
    completedAt: "2026-07-27T12:00:01.000Z",
    steps: Object.freeze([]),
    successful: true,
  });
}

function createDependencies(
  graph: RegisteredServiceDependencyGraph = createGraph(),
): {
  readonly list: ListRegisteredServices;
  readonly generate: GenerateRegisteredServiceAvailabilityReconciliationOccurrences;
  readonly execute: ExecuteRegisteredServiceAvailabilityReconciliationOccurrence;
  readonly getGraph: () => Promise<RegisteredServiceDependencyGraph>;
} {
  const catalog: RegisteredServiceCatalog = {
    list: vi.fn(),
    findById: vi.fn(),
  };
  const planner = new PlanRegisteredServiceAvailabilityReconciliation(
    catalog,
    {
      findByServiceId: vi.fn(),
      save: vi.fn(),
      removeByServiceId: vi.fn(),
      removeByServiceIdIfMatches: vi.fn(),
    },
    { read: vi.fn() },
    { now: vi.fn() },
  );
  const orchestrate = {
    execute: vi
      .fn<OrchestrateRegisteredServiceControl["execute"]>()
      .mockResolvedValue(createOrchestrationResult()),
  } as unknown as OrchestrateRegisteredServiceControl;

  return {
    list: new ListRegisteredServices(catalog),
    generate:
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        catalog,
      ),
    execute: new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
      planner,
      {
        claim: vi.fn(),
        pruneCompletedThrough: vi.fn(),
      },
      orchestrate,
    ),
    getGraph: vi.fn().mockResolvedValue(graph),
  };
}

function createTick(graph = createGraph()) {
  const dependencies = createDependencies(graph);
  const listExecute = vi.spyOn(dependencies.list, "execute");
  const generateExecute = vi.spyOn(dependencies.generate, "execute");
  const occurrenceExecute = vi.spyOn(dependencies.execute, "execute");

  return {
    tick: new RunServiceAvailabilityReconciliationTick(
      dependencies.list,
      dependencies.generate,
      dependencies.execute,
      dependencies.getGraph,
    ),
    listExecute,
    generateExecute,
    occurrenceExecute,
  };
}

describe("RunServiceAvailabilityReconciliationTick", () => {
  it("returns a frozen empty report after listing an empty catalog once", async () => {
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick();
    listExecute.mockResolvedValue([]);

    const result = await tick.execute(
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(listExecute).toHaveBeenCalledTimes(1);
    expect(generateExecute).not.toHaveBeenCalled();
    expect(occurrenceExecute).not.toHaveBeenCalled();
  });

  it("groups occurrences by scheduled-for and executes cross-service in order", async () => {
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick();
    const services = [
      createService("service-a"),
      createService("service-b"),
      createService("service-c"),
    ];
    const firstOccurrence = createOccurrence(
      "service-b",
      "start",
      "2026-07-27T12:00:00.000Z",
    );
    const secondOccurrence = createOccurrence(
      "service-c",
      "start",
      "2026-07-27T13:00:00.000Z",
    );
    const thirdOccurrence = createOccurrence(
      "service-c",
      "stop",
      "2026-07-27T14:00:00.000Z",
    );
    const fromExclusive = new Date("2026-07-27T11:00:00.000Z");
    const toInclusive = new Date("2026-07-27T15:00:00.000Z");
    const noneResult = Object.freeze({ kind: "none" } as const);
    const duplicateResult = Object.freeze({ kind: "duplicate" } as const);
    const executedResult = Object.freeze({
      kind: "executed" as const,
      orchestrationResult: createOrchestrationResult("stop"),
    });
    listExecute.mockResolvedValue(services);
    generateExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([firstOccurrence])
      .mockResolvedValueOnce([secondOccurrence, thirdOccurrence]);
    occurrenceExecute
      .mockResolvedValueOnce(noneResult)
      .mockResolvedValueOnce(duplicateResult)
      .mockResolvedValueOnce(executedResult);

    const result = await tick.execute(fromExclusive, toInclusive);

    expect(generateExecute).toHaveBeenCalledTimes(3);
    expect(occurrenceExecute).toHaveBeenCalledTimes(3);
    expect(result.map((serviceResult) => serviceResult.serviceId)).toEqual([
      "service-a",
      "service-b",
      "service-c",
    ]);

    const completed = result[2];
    expect(completed?.kind).toBe("completed");
    if (completed?.kind !== "completed") {
      throw new Error("Expected completed service result");
    }
    expect(completed.occurrenceResults[0]).toMatchObject({
      kind: "completed",
      occurrence: secondOccurrence,
      result: duplicateResult,
    });
    expect(completed.occurrenceResults[1]).toMatchObject({
      kind: "completed",
      occurrence: thirdOccurrence,
      result: executedResult,
    });
  });

  it("orders same-instant starts dependencies-first and stops dependents-first", async () => {
    const graph = createDependencyGraph([
      { serviceId: "api", dependencies: ["database"] },
      { serviceId: "database", dependencies: [] },
    ]);
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick(graph);
    const services = [
      createService("api", ["database"]),
      createService("database"),
    ];
    const startApi = createOccurrence(
      "api",
      "start",
      "2026-07-27T12:00:00.000Z",
    );
    const startDatabase = createOccurrence(
      "database",
      "start",
      "2026-07-27T12:00:00.000Z",
    );
    const startTrace: string[] = [];
    listExecute.mockResolvedValue(services);
    generateExecute
      .mockResolvedValueOnce([startApi])
      .mockResolvedValueOnce([startDatabase]);
    occurrenceExecute.mockImplementation((occurrence) => {
      startTrace.push(occurrence.serviceId);
      return Promise.resolve(Object.freeze({ kind: "none" }));
    });

    await tick.execute(
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T13:00:00.000Z"),
    );
    expect(startTrace).toEqual(["database", "api"]);

    const stopTrace: string[] = [];
    const stopApi = createOccurrence("api", "stop", "2026-07-27T12:00:00.000Z");
    const stopDatabase = createOccurrence(
      "database",
      "stop",
      "2026-07-27T12:00:00.000Z",
    );
    const stopDependencies = createDependencies(graph);
    const stopList = vi.spyOn(stopDependencies.list, "execute");
    const stopGenerate = vi.spyOn(stopDependencies.generate, "execute");
    const stopExecute = vi.spyOn(stopDependencies.execute, "execute");
    const stopOrderedTick = new RunServiceAvailabilityReconciliationTick(
      stopDependencies.list,
      stopDependencies.generate,
      stopDependencies.execute,
      stopDependencies.getGraph,
    );
    stopList.mockResolvedValue(services);
    stopGenerate
      .mockResolvedValueOnce([stopApi])
      .mockResolvedValueOnce([stopDatabase]);
    stopExecute.mockImplementation((occurrence) => {
      stopTrace.push(occurrence.serviceId);
      return Promise.resolve(Object.freeze({ kind: "none" }));
    });
    await stopOrderedTick.execute(
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T13:00:00.000Z"),
    );
    expect(stopTrace).toEqual(["api", "database"]);
  });

  it("propagates a listing failure and performs no later work", async () => {
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick();
    const sentinel = new Error("listing sentinel");
    listExecute.mockRejectedValue(sentinel);

    await expect(
      tick.execute(
        new Date("2026-07-27T11:00:00.000Z"),
        new Date("2026-07-27T12:00:00.000Z"),
      ),
    ).rejects.toBe(sentinel);
    expect(listExecute).toHaveBeenCalledTimes(1);
    expect(generateExecute).not.toHaveBeenCalled();
    expect(occurrenceExecute).not.toHaveBeenCalled();
  });

  it("isolates generation failures and continues with later services", async () => {
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick();
    const services = [createService("service-a"), createService("service-b")];
    const sentinel = new Error("generation sentinel");
    const occurrence = createOccurrence(
      "service-b",
      "start",
      "2026-07-27T12:00:00.000Z",
    );
    const executionResult = Object.freeze({ kind: "none" } as const);
    listExecute.mockResolvedValue(services);
    generateExecute
      .mockRejectedValueOnce(sentinel)
      .mockResolvedValueOnce([occurrence]);
    occurrenceExecute.mockResolvedValue(executionResult);

    const result = await tick.execute(
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect(result[0]).toEqual({
      kind: "failed",
      serviceId: "service-a",
      error: sentinel,
    });
    expect(result[1]).toMatchObject({
      kind: "completed",
      serviceId: "service-b",
    });
    expect(generateExecute).toHaveBeenCalledTimes(2);
    expect(occurrenceExecute).toHaveBeenCalledExactlyOnceWith(occurrence);
  });

  it("isolates execution failures across later occurrences and services", async () => {
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick();
    const services = [createService("service-a"), createService("service-b")];
    const occurrences = [
      createOccurrence("service-a", "start", "2026-07-27T12:00:00.000Z"),
      createOccurrence("service-a", "stop", "2026-07-27T13:00:00.000Z"),
      createOccurrence("service-b", "start", "2026-07-27T14:00:00.000Z"),
    ];
    const sentinel = new Error("execution sentinel");
    listExecute.mockResolvedValue(services);
    generateExecute
      .mockResolvedValueOnce(occurrences.slice(0, 2))
      .mockResolvedValueOnce(occurrences.slice(2));
    occurrenceExecute
      .mockRejectedValueOnce(sentinel)
      .mockResolvedValueOnce(Object.freeze({ kind: "duplicate" }))
      .mockResolvedValueOnce(Object.freeze({ kind: "none" }));

    const result = await tick.execute(
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T15:00:00.000Z"),
    );

    const firstService = result[0];
    expect(firstService?.kind).toBe("completed");
    if (firstService?.kind !== "completed") {
      throw new Error("Expected completed service result");
    }
    expect(firstService.occurrenceResults[0]).toMatchObject({
      kind: "failed",
      occurrence: occurrences[0],
      error: sentinel,
    });
    expect(firstService.occurrenceResults[1]).toMatchObject({
      kind: "completed",
      occurrence: occurrences[1],
      result: { kind: "duplicate" },
    });
    expect(result[1]).toMatchObject({
      kind: "completed",
      serviceId: "service-b",
    });
  });

  it("processes all generations then all executions for the interval", async () => {
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick();
    const services = [createService("service-a"), createService("service-b")];
    const firstOccurrence = createOccurrence(
      "service-a",
      "start",
      "2026-07-27T12:00:00.000Z",
    );
    const secondOccurrence = createOccurrence(
      "service-b",
      "stop",
      "2026-07-27T13:00:00.000Z",
    );
    const trace: string[] = [];
    listExecute.mockImplementation(() => {
      trace.push("list");
      return Promise.resolve(services);
    });
    generateExecute.mockImplementation((serviceId) => {
      trace.push(`generate:${serviceId}`);
      return Promise.resolve(
        serviceId === "service-a" ? [firstOccurrence] : [secondOccurrence],
      );
    });
    occurrenceExecute.mockImplementation((occurrence) => {
      trace.push(`execute:${occurrence.serviceId}`);
      return Promise.resolve(Object.freeze({ kind: "none" }));
    });

    await tick.execute(
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T14:00:00.000Z"),
    );

    expect(trace).toEqual([
      "list",
      "generate:service-a",
      "generate:service-b",
      "execute:service-a",
      "execute:service-b",
    ]);
  });

  it("deeply freezes report-owned containers without freezing dependency values", async () => {
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick();
    const service = createService("service-a");
    const occurrence = createOccurrence(
      "service-a",
      "start",
      "2026-07-27T12:00:00.000Z",
    );
    const error = new Error("dependency error");
    const fromExclusive = new Date("2026-07-27T11:00:00.000Z");
    const toInclusive = new Date("2026-07-27T13:00:00.000Z");
    listExecute.mockResolvedValue([service]);
    generateExecute.mockResolvedValue([occurrence]);
    occurrenceExecute.mockRejectedValue(error);

    const result = await tick.execute(fromExclusive, toInclusive);
    const serviceResult = result[0];

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(serviceResult)).toBe(true);
    expect(serviceResult?.kind).toBe("completed");
    if (serviceResult?.kind !== "completed") {
      throw new Error("Expected completed service result");
    }
    expect(Object.isFrozen(serviceResult.occurrenceResults)).toBe(true);
    expect(Object.isFrozen(serviceResult.occurrenceResults[0])).toBe(true);
    expect(Object.isFrozen(error)).toBe(false);
    expect(Object.isFrozen(fromExclusive)).toBe(false);
    expect(Object.isFrozen(toInclusive)).toBe(false);
    expect(Object.isFrozen(service)).toBe(true);
    expect(Object.isFrozen(occurrence)).toBe(true);
  });

  it("does not read current time, create timers, or register listeners", async () => {
    const { tick, listExecute } = createTick();
    listExecute.mockResolvedValue([]);
    const dateNow = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOn = vi.spyOn(process, "on");

    await tick.execute(
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect(dateNow).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(processOn).not.toHaveBeenCalled();
  });

  it("creates exact frozen wrapper shapes", async () => {
    const { tick, listExecute, generateExecute, occurrenceExecute } =
      createTick();
    const services = [createService("service-a"), createService("service-b")];
    const generationError = new Error("generation failure");
    const occurrence = createOccurrence(
      "service-b",
      "start",
      "2026-07-27T12:00:00.000Z",
    );
    const executionResult = Object.freeze({ kind: "none" } as const);
    listExecute.mockResolvedValue(services);
    generateExecute
      .mockRejectedValueOnce(generationError)
      .mockResolvedValueOnce([occurrence]);
    occurrenceExecute.mockResolvedValue(executionResult);

    const result = await tick.execute(
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect(Object.keys(result[0] ?? {})).toEqual([
      "kind",
      "serviceId",
      "error",
    ]);
    expect(Object.keys(result[1] ?? {})).toEqual([
      "kind",
      "serviceId",
      "occurrenceResults",
    ]);
    const completed = result[1];
    if (completed?.kind !== "completed") {
      throw new Error("Expected completed service result");
    }
    expect(Object.keys(completed.occurrenceResults[0] ?? {})).toEqual([
      "kind",
      "occurrence",
      "result",
    ]);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[1])).toBe(true);
  });
});
