import { describe, expect, it } from "vitest";

import {
  DefaultPlanRegisteredServiceOrchestration,
  RegisteredServiceOrchestrationPlanError,
  RegisteredServiceOrchestrationStatusError,
} from "../../../src/service-management/application/plan-registered-service-orchestration.js";
import { createDependencyGraph } from "../../../src/service-management/domain/dependency-graph.js";

function graph() {
  return createDependencyGraph([
    { serviceId: "api", dependencies: ["database"] },
    { serviceId: "database", dependencies: [] },
    { serviceId: "worker", dependencies: ["api"] },
  ]);
}

function snapshots(
  states: Readonly<
    Record<string, "running" | "stopped" | "failed" | "unknown">
  >,
) {
  return new Map(
    Object.entries(states).map(([serviceId, state]) => [
      serviceId,
      Object.freeze({
        serviceId,
        state,
        supportedOperations: Object.freeze(["start", "stop", "restart"]),
      }),
    ]),
  );
}

describe("DefaultPlanRegisteredServiceOrchestration", () => {
  const planner = new DefaultPlanRegisteredServiceOrchestration();

  it("plans a transitive dependency-first start without executing effects", () => {
    const plan = planner.execute({
      targetServiceId: "worker",
      operation: "start",
      graph: graph(),
      snapshots: snapshots({
        database: "stopped",
        api: "stopped",
        worker: "stopped",
      }),
    });

    expect(
      plan.steps.map(({ kind, serviceId, operation }) => ({
        kind,
        serviceId,
        operation,
      })),
    ).toEqual([
      { kind: "control", serviceId: "database", operation: "start" },
      {
        kind: "wait_for_readiness",
        serviceId: "database",
        operation: undefined,
      },
      { kind: "control", serviceId: "api", operation: "start" },
      { kind: "wait_for_readiness", serviceId: "api", operation: undefined },
      { kind: "control", serviceId: "worker", operation: "start" },
      { kind: "wait_for_readiness", serviceId: "worker", operation: undefined },
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.steps)).toBe(true);
  });

  it("plans dependent-first stop and skips services already stopped", () => {
    const plan = planner.execute({
      targetServiceId: "database",
      operation: "stop",
      graph: graph(),
      snapshots: snapshots({
        database: "running",
        api: "stopped",
        worker: "running",
      }),
    });

    expect(plan.steps).toEqual([
      { kind: "control", serviceId: "worker", operation: "stop" },
      { kind: "control", serviceId: "api" },
      { kind: "control", serviceId: "database", operation: "stop" },
    ]);
  });

  it("restores only active dependents after a target restart", () => {
    const plan = planner.execute({
      targetServiceId: "api",
      operation: "restart",
      graph: graph(),
      snapshots: snapshots({
        database: "running",
        api: "running",
        worker: "running",
      }),
    });

    expect(plan.steps).toEqual([
      { kind: "control", serviceId: "worker", operation: "stop" },
      { kind: "control", serviceId: "api", operation: "restart" },
      { kind: "wait_for_readiness", serviceId: "api" },
      { kind: "control", serviceId: "worker", operation: "start" },
      { kind: "wait_for_readiness", serviceId: "worker" },
    ]);
  });

  it("rejects failed or unknown services before the first effect", () => {
    expect(() =>
      planner.execute({
        targetServiceId: "worker",
        operation: "start",
        graph: graph(),
        snapshots: snapshots({
          database: "failed",
          api: "stopped",
          worker: "stopped",
        }),
      }),
    ).toThrow(RegisteredServiceOrchestrationStatusError);
  });

  it("rejects unsupported operations during preflight", () => {
    expect(() =>
      planner.execute({
        targetServiceId: "api",
        operation: "restart",
        graph: graph(),
        snapshots: new Map([
          [
            "database",
            {
              serviceId: "database",
              state: "running" as const,
              supportedOperations: ["start", "stop"],
            },
          ],
          [
            "api",
            {
              serviceId: "api",
              state: "running" as const,
              supportedOperations: ["start", "stop"],
            },
          ],
        ]),
      }),
    ).toThrow(RegisteredServiceOrchestrationPlanError);
  });
});
