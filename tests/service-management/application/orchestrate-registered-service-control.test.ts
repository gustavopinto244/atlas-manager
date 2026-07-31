/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access */
import { describe, expect, it, vi } from "vitest";

import {
  OrchestrateRegisteredServiceControl,
  UnavailableDependencyBlockedError,
} from "../../../src/service-management/application/orchestrate-registered-service-control.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceController } from "../../../src/service-management/application/ports/service-controller.js";
import type { WaitForRegisteredServiceReadinessPort } from "../../../src/service-management/application/wait-for-registered-service-readiness.js";
import type { GetRegisteredServiceEffectiveAvailabilityPort } from "../../../src/service-management/application/get-registered-service-effective-availability.js";
import type { RegisteredServiceDependencyGraph } from "../../../src/service-management/domain/dependency-graph.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { RegisteredServiceNotFoundError } from "../../../src/service-management/application/registered-service-not-found-error.js";

const SERVICE_A = "service-a";
const SERVICE_B = "service-b";

function createService(
  id: string,
  supportedOperations: readonly (
    "readStatus" | "start" | "stop" | "restart"
  )[] = ["readStatus", "start", "stop", "restart"],
): RegisteredService {
  return RegisteredService.create({
    id,
    displayName: `Service ${id}`,
    managementAdapter: "mock",
    externalResourceId: `resource-${id}`,
    supportedOperations,
    availabilityPolicy: { mode: "manual" },
  });
}

describe("OrchestrateRegisteredServiceControl", () => {
  describe("start operation", () => {
    it("executes start for single service without dependencies", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "start");

      expect(result.successful).toBe(true);
      expect(Object.isFrozen(result.steps[0])).toBe(true);
      expect(Object.isFrozen(result.steps[0]?.outcome)).toBe(true);
      expect(result.targetServiceId).toBe(SERVICE_A);
      expect(result.requestedOperation).toBe("start");
      expect(controller.execute).toHaveBeenCalledOnce();
      expect(waitForReadiness.execute).toHaveBeenCalledOnce();
    });

    it("executes start for service with dependencies in topological order", async () => {
      const serviceA = createService(SERVICE_A);
      const serviceB = createService(SERVICE_B);

      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockImplementation(async (id: string) => {
          if (id === SERVICE_A) return serviceA;
          if (id === SERVICE_B) return serviceB;
          return null;
        }),
      };

      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([SERVICE_B]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi
          .fn()
          .mockReturnValue([SERVICE_B, SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A, SERVICE_B],
      };

      const events: string[] = [];
      const controller: ServiceController = {
        execute: vi.fn().mockImplementation(async (service, operation) => {
          events.push(`control:${operation}:${service.id}`);
        }),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockImplementation(async (serviceId) => {
          events.push(`readiness:${serviceId}`);
        }),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "start");

      expect(result.successful).toBe(true);
      expect(events).toEqual([
        "control:start:service-b",
        "readiness:service-b",
        "control:start:service-a",
        "readiness:service-a",
      ]);
    });

    it("throws UnavailableDependencyBlockedError when dependency is unavailable", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("unavailable" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([SERVICE_B]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi
          .fn()
          .mockReturnValue([SERVICE_B, SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A, SERVICE_B],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      await expect(
        orchestrator.execute(SERVICE_A, "start", "scheduled"),
      ).rejects.toThrow(UnavailableDependencyBlockedError);
      expect(controller.execute).not.toHaveBeenCalled();
    });

    it("throws UnavailableDependencyBlockedError when dependency is disabled", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("disabled" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([SERVICE_B]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi
          .fn()
          .mockReturnValue([SERVICE_B, SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A, SERVICE_B],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      await expect(
        orchestrator.execute(SERVICE_A, "start", "scheduled"),
      ).rejects.toThrow(UnavailableDependencyBlockedError);
    });

    it("throws RegisteredServiceNotFoundError when target service does not exist", async () => {
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(null),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([]),
        hasService: vi.fn().mockReturnValue(false),
        serviceIds: [],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      await expect(orchestrator.execute(SERVICE_A, "start")).rejects.toThrow(
        RegisteredServiceNotFoundError,
      );
    });
  });

  describe("stop operation", () => {
    it("executes stop for single service without dependents", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "stop");

      expect(result.successful).toBe(true);
      expect(controller.execute).toHaveBeenCalledOnce();
      expect(waitForReadiness.execute).not.toHaveBeenCalled();
    });

    it("executes stop for service with dependents in reverse topological order", async () => {
      const serviceA = createService(SERVICE_A);
      const serviceB = createService(SERVICE_B);

      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockImplementation(async (id: string) => {
          if (id === SERVICE_A) return serviceA;
          if (id === SERVICE_B) return serviceB;
          return null;
        }),
      };

      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([SERVICE_B]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi
          .fn()
          .mockReturnValue([SERVICE_B, SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A, SERVICE_B],
      };

      const events: string[] = [];
      const controller: ServiceController = {
        execute: vi.fn().mockImplementation(async (service, operation) => {
          events.push(`control:${operation}:${service.id}`);
        }),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "stop");

      expect(result.successful).toBe(true);
      expect(events).toEqual([
        "control:stop:service-b",
        "control:stop:service-a",
      ]);
    });
  });

  describe("restart operation", () => {
    it("executes restart with stop-dependents, restart-target, start-dependents sequence", async () => {
      const serviceA = createService(SERVICE_A);
      const serviceB = createService(SERVICE_B);

      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockImplementation(async (id: string) => {
          if (id === SERVICE_A) return serviceA;
          if (id === SERVICE_B) return serviceB;
          return null;
        }),
      };

      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([SERVICE_B]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_B]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A, SERVICE_B],
      };

      const events: string[] = [];
      const controller: ServiceController = {
        execute: vi.fn().mockImplementation(async (service, operation) => {
          events.push(`control:${operation}:${service.id}`);
        }),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockImplementation(async (serviceId) => {
          events.push(`readiness:${serviceId}`);
        }),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "restart");

      expect(result.successful).toBe(true);
      expect(events).toEqual([
        "control:stop:service-b",
        "control:restart:service-a",
        "readiness:service-a",
        "control:start:service-b",
        "readiness:service-b",
      ]);
    });
  });

  describe("error handling", () => {
    it("marks step as failed and stops execution when controller.execute throws", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockRejectedValue(new Error("Control failed")),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "start");

      expect(result.successful).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]?.outcome.kind).toBe("failed");
      expect(waitForReadiness.execute).not.toHaveBeenCalled();
    });

    it("marks step as failed and stops execution when waitForReadiness throws", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockRejectedValue(new Error("Readiness timeout")),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "start");

      expect(result.successful).toBe(false);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0]?.outcome.kind).toBe("executed");
      expect(result.steps[1]?.outcome.kind).toBe("failed");
    });

    it("marks step as failed when operation is not supported", async () => {
      const service = createService(SERVICE_A, ["readStatus", "start"]);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "stop");

      expect(result.successful).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]?.outcome.kind).toBe("failed");
    });

    it("does not execute subsequent steps after a failure", async () => {
      const serviceA = createService(SERVICE_A);
      const serviceB = createService(SERVICE_B);

      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockImplementation(async (id: string) => {
          if (id === SERVICE_A) return serviceA;
          if (id === SERVICE_B) return serviceB;
          return null;
        }),
      };

      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([SERVICE_B]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi
          .fn()
          .mockReturnValue([SERVICE_B, SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A, SERVICE_B],
      };

      const events: string[] = [];
      const controller: ServiceController = {
        execute: vi.fn().mockImplementation(async (service, operation) => {
          events.push(`control:${operation}:${service.id}`);
          if (service.id === SERVICE_B) {
            throw new Error("Dependency failed");
          }
        }),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "start");

      expect(result.successful).toBe(false);
      expect(events).toEqual(["control:start:service-b"]);
      expect(controller.execute).toHaveBeenCalledOnce();
    });
  });

  describe("result structure", () => {
    it("returns frozen OrchestrationResult with all completed steps", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "start");

      expect(Object.isFrozen(result)).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0]?.kind).toBe("control");
      expect(result.steps[1]?.kind).toBe("wait_for_readiness");
    });

    it("includes correct startedAt and completedAt timestamps", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);

      let callCount = 0;
      const clock = {
        now: vi.fn(() => {
          callCount++;
          if (callCount === 1) return new Date("2026-07-27T12:00:00.000Z");
          if (callCount === 2) return new Date("2026-07-27T12:00:01.000Z");
          return new Date("2026-07-27T12:00:02.000Z");
        }),
      };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "start");

      expect(result.startedAt).toBe("2026-07-27T12:00:00.000Z");
      expect(result.completedAt).toBe("2026-07-27T12:00:02.000Z");
    });

    it("includes targetServiceId and requestedOperation in result", async () => {
      const service = createService(SERVICE_A);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(service),
      };
      const controller: ServiceController = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const waitForReadiness: WaitForRegisteredServiceReadinessPort = {
        execute: vi.fn().mockResolvedValue(undefined),
      };
      const getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort =
        {
          execute: vi.fn().mockResolvedValue("available" as const),
        };
      const graph: RegisteredServiceDependencyGraph = {
        directDependenciesOf: vi.fn().mockReturnValue([]),
        directDependentsOf: vi.fn().mockReturnValue([]),
        transitiveDependenciesOf: vi.fn().mockReturnValue([]),
        transitiveDependentsOf: vi.fn().mockReturnValue([]),
        topologicalDependenciesFirst: vi.fn().mockReturnValue([SERVICE_A]),
        topologicalDependentsFirst: vi.fn().mockReturnValue([SERVICE_A]),
        hasService: vi.fn().mockReturnValue(true),
        serviceIds: [SERVICE_A],
      };
      const getGraph = vi.fn().mockResolvedValue(graph);
      const clock = { now: vi.fn(() => new Date("2026-07-27T12:00:00.000Z")) };

      const orchestrator = new OrchestrateRegisteredServiceControl(
        catalog,
        controller,
        getGraph,
        waitForReadiness,
        clock,
        getEffectiveAvailability,
      );

      const result = await orchestrator.execute(SERVICE_A, "stop");

      expect(result.targetServiceId).toBe(SERVICE_A);
      expect(result.requestedOperation).toBe("stop");
    });
  });
});
