/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";
import { OrchestrateRegisteredServicesStop } from "../../../src/service-management/application/orchestrate-registered-services-stop.js";
import { createDependencyGraph } from "../../../src/service-management/domain/dependency-graph.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceStatusReader } from "../../../src/service-management/application/ports/service-status-reader.js";
import type { ServiceController } from "../../../src/service-management/application/ports/service-controller.js";

const at = "2026-08-03T21:00:00.000Z";
function service(
  id: string,
  dependencies: readonly string[] = [],
  supportedOperations = ["readStatus", "stop"],
): RegisteredService {
  return RegisteredService.create({
    id,
    displayName: id,
    managementAdapter: "mock",
    externalResourceId: id,
    supportedOperations,
    availabilityPolicy: { mode: "always" },
    dependencies,
  });
}
function harness(
  states: Record<string, "running" | "stopped" | "failed" | "unknown">,
  failOn?: string,
  throwStatusFor?: string,
  throwGraph = false,
) {
  const services = [
    service("database"),
    service("api", ["database"]),
    service("worker", ["database"]),
  ] as const;
  const catalog: RegisteredServiceCatalog = {
    list: vi.fn(async () => services),
    findById: vi.fn(
      async (id) => services.find((value) => value.id === id) ?? null,
    ),
  };
  const status: ServiceStatusReader = {
    read: vi.fn(async (value) => {
      if (value.id === throwStatusFor) throw new Error("raw status detail");
      return states[value.id] ?? "unknown";
    }),
  };
  const events: string[] = [];
  const controller: ServiceController = {
    execute: vi.fn(async (value) => {
      events.push(value.id);
      if (value.id === failOn) throw new Error("raw controller detail");
    }),
  };
  const graph = createDependencyGraph(
    services.map((value) => ({
      serviceId: value.id,
      dependencies: value.dependencies,
    })),
  );
  return {
    useCase: new OrchestrateRegisteredServicesStop(
      catalog,
      status,
      controller,
      async () => {
        if (throwGraph) throw new Error("raw graph detail");
        return graph;
      },
      { now: () => new Date(at) },
    ),
    catalog,
    status,
    controller,
    events,
  };
}
describe("OrchestrateRegisteredServicesStop", () => {
  it("validates before dependencies and rejects duplicate, invalid, unknown-authority, and extra input", async () => {
    const h = harness({
      api: "running",
      worker: "running",
      database: "running",
    });
    for (const input of [
      { serviceIds: ["api", "api"], authority: "machine_shutdown" },
      { serviceIds: ["API"], authority: "machine_shutdown" },
      { serviceIds: ["api"], authority: "manual" },
      { serviceIds: ["api"], authority: "machine_shutdown", extra: true },
    ])
      await expect(h.useCase.execute(input)).rejects.toThrow();
    expect(h.catalog.list).not.toHaveBeenCalled();
    expect(h.status.read).not.toHaveBeenCalled();
  });

  it("stops only requested services in dependent-first lexical order", async () => {
    const h = harness({
      api: "running",
      worker: "running",
      database: "running",
    });
    const result = await h.useCase.execute(
      {
        serviceIds: ["api", "database", "worker"],
        authority: "machine_shutdown",
      },
      at,
    );
    expect(h.events).toEqual(["api", "worker", "database"]);
    expect(h.status.read).toHaveBeenCalledTimes(3);
    expect(result.steps.map((step) => step.serviceId)).toEqual([
      "api",
      "worker",
      "database",
    ]);
    expect(result.successful).toBe(true);
  });

  it("skips stopped services and stops at the first failed control without rollback", async () => {
    const h = harness(
      { api: "running", worker: "running", database: "running" },
      "worker",
    );
    const result = await h.useCase.execute(
      {
        serviceIds: ["api", "worker", "database"],
        authority: "machine_shutdown",
      },
      at,
    );
    expect(h.events).toEqual(["api", "worker"]);
    expect(result.steps).toEqual([
      { serviceId: "api", outcome: "stopped" },
      {
        serviceId: "worker",
        outcome: "failed",
        failureCode: "service_stop_failed",
      },
    ]);
    const stopped = harness({
      api: "stopped",
      worker: "running",
      database: "running",
    });
    const stoppedResult = await stopped.useCase.execute(
      {
        serviceIds: ["api", "worker", "database"],
        authority: "machine_shutdown",
      },
      at,
    );
    expect(stoppedResult.steps[0]).toEqual({
      serviceId: "api",
      outcome: "already_stopped",
    });
  });

  it("fails safely for status failures, unsupported stops, and unknown requested services", async () => {
    const statusFailure = harness({
      api: "unknown",
      worker: "running",
      database: "running",
    });
    await expect(
      statusFailure.useCase.execute(
        { serviceIds: ["api", "database"], authority: "machine_shutdown" },
        at,
      ),
    ).resolves.toMatchObject({
      steps: [{ outcome: "failed", failureCode: "service_status_failed" }],
    });
    const unsupportedService = RegisteredService.create({
      id: "api",
      displayName: "api",
      managementAdapter: "mock",
      externalResourceId: "api",
      supportedOperations: ["readStatus"],
      availabilityPolicy: { mode: "always" },
      dependencies: [],
    });
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn(async () => [unsupportedService]),
      findById: vi.fn(async () => unsupportedService),
    };
    const useCase = new OrchestrateRegisteredServicesStop(
      catalog,
      { read: vi.fn(async () => "running" as const) },
      { execute: vi.fn() },
      async () =>
        createDependencyGraph([{ serviceId: "api", dependencies: [] }]),
      { now: () => new Date(at) },
    );
    await expect(
      useCase.execute(
        { serviceIds: ["api"], authority: "machine_shutdown" },
        at,
      ),
    ).resolves.toMatchObject({
      steps: [{ failureCode: "service_stop_not_supported" }],
    });
    await expect(
      statusFailure.useCase.execute(
        { serviceIds: ["missing"], authority: "machine_shutdown" },
        at,
      ),
    ).rejects.toThrow();
  });

  it("translates status and dependency failures into safe project results", async () => {
    const statusFailure = harness(
      { api: "running", database: "running" },
      undefined,
      "api",
    );
    await expect(
      statusFailure.useCase.execute(
        { serviceIds: ["api"], authority: "machine_shutdown" },
        at,
      ),
    ).resolves.toMatchObject({
      successful: false,
      steps: [{ serviceId: "api", failureCode: "service_status_failed" }],
    });
    const graphFailure = harness(
      { api: "running", database: "running" },
      undefined,
      undefined,
      true,
    );
    await expect(
      graphFailure.useCase.execute(
        { serviceIds: ["api"], authority: "machine_shutdown" },
        at,
      ),
    ).resolves.toMatchObject({
      successful: false,
      steps: [{ failureCode: "service_plan_invalid" }],
    });
  });
});
