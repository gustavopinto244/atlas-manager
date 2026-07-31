import { describe, expect, it } from "vitest";

import { createDependencyGraph } from "../../../src/service-management/domain/dependency-graph.js";

describe("RegisteredServiceDependencyGraph", () => {
  it("supports empty and unknown graph queries with frozen collections", () => {
    const graph = createDependencyGraph([]);

    expect(graph.serviceIds).toEqual([]);
    expect(graph.hasService("missing")).toBe(false);
    expect(graph.directDependenciesOf("missing")).toEqual([]);
    expect(graph.directDependentsOf("missing")).toEqual([]);
    expect(graph.transitiveDependenciesOf("missing")).toEqual([]);
    expect(graph.transitiveDependentsOf("missing")).toEqual([]);
    expect(graph.topologicalDependenciesFirst([])).toEqual([]);
    expect(graph.topologicalDependentsFirst([])).toEqual([]);
    expect(Object.isFrozen(graph.serviceIds)).toBe(true);
    expect(Object.isFrozen(graph.directDependenciesOf("missing"))).toBe(true);
    expect(Object.isFrozen(graph.topologicalDependenciesFirst([]))).toBe(true);
  });

  it("orders a linear graph in both directions", () => {
    const graph = createDependencyGraph([
      { serviceId: "storage", dependencies: [] },
      { serviceId: "database", dependencies: ["storage"] },
      { serviceId: "api", dependencies: ["database"] },
      { serviceId: "worker", dependencies: ["api"] },
    ]);

    expect(graph.directDependenciesOf("database")).toEqual(["storage"]);
    expect(graph.directDependentsOf("database")).toEqual(["api"]);
    expect(graph.transitiveDependenciesOf("worker")).toEqual([
      "api",
      "database",
      "storage",
    ]);
    expect(graph.transitiveDependentsOf("storage")).toEqual([
      "api",
      "database",
      "worker",
    ]);
    expect(graph.topologicalDependenciesFirst(["worker"])).toEqual([
      "storage",
      "database",
      "api",
      "worker",
    ]);
    expect(graph.topologicalDependentsFirst(["storage"])).toEqual([
      "worker",
      "api",
      "database",
      "storage",
    ]);
  });
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

  it("uses lexical tie-breaking independent of input order", () => {
    const entries = [
      { serviceId: "api", dependencies: ["redis", "postgres"] },
      { serviceId: "redis", dependencies: [] },
      { serviceId: "postgres", dependencies: [] },
    ];
    const reversedGraph = createDependencyGraph([...entries].reverse());

    expect(reversedGraph.topologicalDependenciesFirst(["api"])).toEqual([
      "postgres",
      "redis",
      "api",
    ]);
    expect(reversedGraph.topologicalDependentsFirst(["postgres"])).toEqual([
      "api",
      "postgres",
    ]);
  });

  it("deduplicates multiple requested roots and shared closure nodes", () => {
    const graph = createDependencyGraph([
      { serviceId: "database", dependencies: [] },
      { serviceId: "api", dependencies: ["database"] },
      { serviceId: "worker", dependencies: ["database"] },
    ]);

    expect(
      graph.topologicalDependenciesFirst(["api", "worker", "api"]),
    ).toEqual(["database", "api", "worker"]);
  });

  it("copies mutable input arrays and freezes every returned collection", () => {
    const dependencies = ["database"];
    const entries = [
      { serviceId: "database", dependencies: [] },
      { serviceId: "api", dependencies },
    ];
    const graph = createDependencyGraph(entries);

    dependencies.push("other");
    entries.push({ serviceId: "other", dependencies: [] });

    expect(graph.serviceIds).toEqual(["api", "database"]);
    expect(graph.directDependenciesOf("api")).toEqual(["database"]);
    expect(Object.isFrozen(graph.directDependenciesOf("api"))).toBe(true);
    expect(Object.isFrozen(graph.directDependentsOf("database"))).toBe(true);
    expect(Object.isFrozen(graph.transitiveDependenciesOf("api"))).toBe(true);
    expect(Object.isFrozen(graph.topologicalDependenciesFirst(["api"]))).toBe(
      true,
    );
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
    [
      "indirect_circular_dependency",
      [
        { serviceId: "api", dependencies: ["worker"] },
        { serviceId: "worker", dependencies: ["queue"] },
        { serviceId: "queue", dependencies: ["api"] },
      ],
    ],
    [
      "longer_circular_dependency",
      [
        { serviceId: "a", dependencies: ["b"] },
        { serviceId: "b", dependencies: ["c"] },
        { serviceId: "c", dependencies: ["d"] },
        { serviceId: "d", dependencies: ["b"] },
      ],
    ],
    [
      "cycle_in_disconnected_component",
      [
        { serviceId: "database", dependencies: [] },
        { serviceId: "api", dependencies: ["database"] },
        { serviceId: "a", dependencies: ["b"] },
        { serviceId: "b", dependencies: ["a"] },
      ],
    ],
    [
      "duplicate_service_entry",
      [
        { serviceId: "api", dependencies: [] },
        { serviceId: "api", dependencies: [] },
      ],
    ],
  ] as const)("rejects %s", (code, entries) => {
    expect(() => createDependencyGraph(entries)).toThrowError(
      expect.objectContaining({
        name: "DependencyValidationError",
        code:
          code === "indirect_circular_dependency" ||
          code === "longer_circular_dependency" ||
          code === "cycle_in_disconnected_component"
            ? "circular_dependency"
            : code === "duplicate_service_entry"
              ? "duplicate_dependency"
              : code,
      }),
    );
  });

  it("handles a bounded large acyclic chain without recursive traversal", () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
      serviceId: `service-${index}`,
      dependencies: index === 0 ? [] : [`service-${index - 1}`],
    }));
    const graph = createDependencyGraph(entries);

    expect(graph.topologicalDependenciesFirst(["service-99"])).toHaveLength(
      100,
    );
    expect(graph.transitiveDependenciesOf("service-99")).toHaveLength(99);
  });
});
