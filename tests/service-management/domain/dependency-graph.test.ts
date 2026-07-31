import { describe, expect, it } from "vitest";

import { createDependencyGraph } from "../../../src/service-management/domain/dependency-graph.js";

describe("RegisteredServiceDependencyGraph", () => {
  it("supports direct and transitive dependency/dependent queries", () => {
    const graph = createDependencyGraph([
      { serviceId: "database", dependencies: [] },
      { serviceId: "api", dependencies: ["database"] },
      { serviceId: "worker", dependencies: ["api"] },
    ]);

    expect(graph.directDependenciesOf("api")).toEqual(["database"]);
    expect(graph.directDependentsOf("database")).toEqual(["api"]);
    expect(graph.transitiveDependenciesOf("worker")).toEqual([
      "api",
      "database",
    ]);
    expect(graph.transitiveDependentsOf("database")).toEqual(["api", "worker"]);
  });

  it("orders diamond graphs deterministically without duplicates", () => {
    const graph = createDependencyGraph([
      { serviceId: "database", dependencies: [] },
      { serviceId: "redis", dependencies: [] },
      { serviceId: "api", dependencies: ["database", "redis"] },
      { serviceId: "worker", dependencies: ["database"] },
      { serviceId: "frontend", dependencies: ["api", "worker"] },
    ]);

    expect(graph.topologicalDependenciesFirst(["frontend"])).toEqual([
      "database",
      "redis",
      "api",
      "worker",
      "frontend",
    ]);
    expect(graph.topologicalDependentsFirst(["database"])).toEqual([
      "frontend",
      "worker",
      "api",
      "database",
    ]);
  });

  it("supports disconnected components and frozen results", () => {
    const graph = createDependencyGraph([
      { serviceId: "a", dependencies: [] },
      { serviceId: "b", dependencies: ["a"] },
      { serviceId: "x", dependencies: [] },
      { serviceId: "y", dependencies: ["x"] },
    ]);

    expect(graph.topologicalDependenciesFirst(["b", "y"])).toEqual([
      "a",
      "x",
      "b",
      "y",
    ]);
    expect(Object.isFrozen(graph.serviceIds)).toBe(true);
    expect(Object.isFrozen(graph.directDependenciesOf("b"))).toBe(true);
  });

  it.each([
    ["unknown_dependency", [{ serviceId: "api", dependencies: ["db"] }]],
    [
      "circular_dependency",
      [
        { serviceId: "a", dependencies: ["b"] },
        { serviceId: "b", dependencies: ["a"] },
      ],
    ],
  ] as const)("rejects %s", (code, entries) => {
    expect(() => createDependencyGraph(entries)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});
