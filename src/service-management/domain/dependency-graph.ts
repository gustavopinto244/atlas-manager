export const MAX_DIRECT_DEPENDENCIES_PER_SERVICE = 16;

export class DependencyValidationError extends Error {
  public constructor(
    public readonly code:
      | "invalid_dependencies_type"
      | "invalid_dependency_id"
      | "duplicate_dependency"
      | "self_dependency"
      | "unknown_dependency"
      | "circular_dependency"
      | "exceeds_limit",
    message?: string,
  ) {
    super(message ?? `Dependency validation failed: ${code}`);
    this.name = "DependencyValidationError";
    Object.freeze(this);
  }
}

export interface RegisteredServiceDependencyGraph {
  readonly directDependenciesOf: (serviceId: string) => readonly string[];
  readonly directDependentsOf: (serviceId: string) => readonly string[];
  readonly transitiveDependenciesOf: (serviceId: string) => readonly string[];
  readonly transitiveDependentsOf: (serviceId: string) => readonly string[];
  readonly topologicalDependenciesFirst: (
    serviceIds: readonly string[],
  ) => readonly string[];
  readonly topologicalDependentsFirst: (
    serviceIds: readonly string[],
  ) => readonly string[];
  readonly hasService: (serviceId: string) => boolean;
  readonly serviceIds: readonly string[];
}

interface GraphNode {
  readonly serviceId: string;
  readonly directDependencies: readonly string[];
  readonly directDependents: string[];
}

export function createDependencyGraph(
  entries: ReadonlyArray<{
    serviceId: string;
    dependencies: readonly string[];
  }>,
): RegisteredServiceDependencyGraph {
  const nodeMap = new Map<string, GraphNode>();
  const idSet = new Set<string>();

  for (const entry of entries) {
    if (idSet.has(entry.serviceId)) {
      throw new DependencyValidationError(
        "duplicate_dependency",
        `Duplicate service ID: ${entry.serviceId}`,
      );
    }
    idSet.add(entry.serviceId);
    nodeMap.set(entry.serviceId, {
      serviceId: entry.serviceId,
      directDependencies: Object.freeze([...entry.dependencies]),
      directDependents: [],
    });
  }

  for (const entry of entries) {
    for (const _depId of entry.dependencies) {
      const depNode = nodeMap.get(_depId);
      if (!depNode) {
        throw new DependencyValidationError("unknown_dependency");
      }
      depNode.directDependents.push(entry.serviceId);
    }
  }

  for (const node of nodeMap.values()) {
    node.directDependents.sort();
    Object.freeze(node.directDependents);
  }

  const graph = Object.freeze(new Map(nodeMap));
  const serviceIds = Object.freeze([...idSet].sort());

  detectCycles(graph);

  return Object.freeze({
    directDependenciesOf: (serviceId: string) => {
      const node = graph.get(serviceId);
      return node ? node.directDependencies : Object.freeze([]);
    },
    directDependentsOf: (serviceId: string) => {
      const node = graph.get(serviceId);
      return node
        ? Object.freeze([...node.directDependents])
        : Object.freeze([]);
    },
    transitiveDependenciesOf: (serviceId: string) =>
      computeClosure(graph, serviceId, "dependencies"),
    transitiveDependentsOf: (serviceId: string) =>
      computeClosure(graph, serviceId, "dependents"),
    topologicalDependenciesFirst: (ids: readonly string[]) =>
      topologicalSort(graph, ids, "forward"),
    topologicalDependentsFirst: (ids: readonly string[]) =>
      topologicalSort(graph, ids, "reverse"),
    hasService: (serviceId: string) => graph.has(serviceId),
    serviceIds,
  });
}

function computeClosure(
  graph: ReadonlyMap<string, GraphNode>,
  startId: string,
  direction: "dependencies" | "dependents",
): readonly string[] {
  const result = new Set<string>();
  const stack = [startId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const node = graph.get(current);
    if (!node) continue;

    const neighbors =
      direction === "dependencies"
        ? node.directDependencies
        : node.directDependents;

    for (const neighbor of neighbors) {
      if (!result.has(neighbor) && neighbor !== startId) {
        result.add(neighbor);
        stack.push(neighbor);
      }
    }
  }

  return Object.freeze([...result].sort());
}

function topologicalSort(
  graph: ReadonlyMap<string, GraphNode>,
  ids: readonly string[],
  direction: "forward" | "reverse",
): readonly string[] {
  const closure = new Set<string>();

  for (const id of ids) {
    const deps =
      direction === "forward"
        ? computeClosure(graph, id, "dependencies")
        : computeClosure(graph, id, "dependents");
    for (const dep of deps) {
      closure.add(dep);
    }
  }

  for (const id of ids) {
    closure.add(id);
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of closure) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const id of closure) {
    const node = graph.get(id);
    if (!node) continue;

    const edges = node.directDependencies;

    for (const neighbor of edges) {
      if (closure.has(neighbor)) {
        adjacency.get(neighbor)!.push(id);
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  queue.sort();

  const result: string[] = [];
  while (queue.length > 0) {
    const batch = [...queue].sort();
    queue.length = 0;

    for (const current of batch) {
      result.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }
  }

  return Object.freeze(
    direction === "forward" ? result : [...result].reverse(),
  );
}

function detectCycles(graph: ReadonlyMap<string, GraphNode>): void {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of graph.keys()) {
    indegree.set(id, graph.get(id)?.directDependencies.length ?? 0);
    dependents.set(id, []);
  }
  for (const node of graph.values()) {
    for (const dependency of node.directDependencies) {
      dependents.get(dependency)?.push(node.serviceId);
    }
  }
  const queue = [...indegree]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const dependent of dependents.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 1) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        queue.push(dependent);
        queue.sort();
      }
    }
  }
  if (visited !== graph.size) {
    throw new DependencyValidationError("circular_dependency");
  }
}
