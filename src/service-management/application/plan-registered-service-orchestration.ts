import type { RegisteredServiceDependencyGraph } from "../domain/dependency-graph.js";
import {
  createOrchestrationPlan,
  type OrchestrationPlan,
  type OrchestrationStep,
} from "../domain/orchestration-plan.js";

export type RegisteredServiceOrchestrationOperation =
  "start" | "stop" | "restart";

export type OrchestrationAuthority = "manual" | "scheduled";

export type RegisteredServiceRuntimeSnapshot = Readonly<{
  serviceId: string;
  state: "running" | "stopped" | "failed" | "unknown";
  supportedOperations: readonly string[];
}>;

export class RegisteredServiceOrchestrationStatusError extends Error {
  public readonly serviceId: string;

  public constructor(serviceId: string) {
    super("Registered service status cannot safely support orchestration");
    this.name = "RegisteredServiceOrchestrationStatusError";
    this.serviceId = serviceId;
    Object.freeze(this);
  }
}

export class RegisteredServiceOrchestrationPlanError extends Error {
  public constructor() {
    super("Registered service orchestration plan is invalid");
    this.name = "RegisteredServiceOrchestrationPlanError";
    Object.freeze(this);
  }
}

export interface PlanRegisteredServiceOrchestrationInput {
  readonly targetServiceId: string;
  readonly operation: RegisteredServiceOrchestrationOperation;
  readonly graph: RegisteredServiceDependencyGraph;
  readonly snapshots: ReadonlyMap<string, RegisteredServiceRuntimeSnapshot>;
}

export interface PlanRegisteredServiceOrchestration {
  readonly execute: (
    input: PlanRegisteredServiceOrchestrationInput,
  ) => OrchestrationPlan;
}

export function getCandidateServiceIds(
  input: Pick<
    PlanRegisteredServiceOrchestrationInput,
    "targetServiceId" | "operation" | "graph"
  >,
): readonly string[] {
  if (input.operation === "start") {
    return input.graph.topologicalDependenciesFirst([
      ...input.graph.transitiveDependenciesOf(input.targetServiceId),
      input.targetServiceId,
    ]);
  }

  const ordered = input.graph.topologicalDependentsFirst([
    ...input.graph.transitiveDependentsOf(input.targetServiceId),
    input.targetServiceId,
  ]);
  return ordered.includes(input.targetServiceId)
    ? ordered
    : Object.freeze([...ordered, input.targetServiceId]);
}

export class DefaultPlanRegisteredServiceOrchestration implements PlanRegisteredServiceOrchestration {
  public execute(
    input: PlanRegisteredServiceOrchestrationInput,
  ): OrchestrationPlan {
    if (!input.graph.hasService(input.targetServiceId)) {
      throw new RegisteredServiceOrchestrationPlanError();
    }

    const serviceIds = getCandidateServiceIds(input);
    for (const serviceId of serviceIds) {
      if (!input.snapshots.has(serviceId)) {
        throw new RegisteredServiceOrchestrationPlanError();
      }
    }

    const steps =
      input.operation === "start"
        ? planStart(input)
        : input.operation === "stop"
          ? planStop(input)
          : planRestart(input);

    validatePlannedOperations(input, steps);

    return createOrchestrationPlan({
      targetServiceId: input.targetServiceId,
      requestedOperation: input.operation,
      steps,
    });
  }
}

function planStart(
  input: PlanRegisteredServiceOrchestrationInput,
): readonly OrchestrationStep[] {
  const ordered = getCandidateServiceIds(input);
  const steps: OrchestrationStep[] = [];

  for (const serviceId of ordered) {
    const snapshot = input.snapshots.get(serviceId)!;
    if (snapshot.state === "running") {
      steps.push({ kind: "wait_for_readiness", serviceId });
      continue;
    }
    if (snapshot.state === "failed" || snapshot.state === "unknown") {
      throw new RegisteredServiceOrchestrationStatusError(serviceId);
    }
    steps.push({ kind: "control", serviceId, operation: "start" });
    steps.push({ kind: "wait_for_readiness", serviceId });
  }

  return steps;
}

function planStop(
  input: PlanRegisteredServiceOrchestrationInput,
): readonly OrchestrationStep[] {
  return getCandidateServiceIds(input).map((serviceId) => {
    const snapshot = input.snapshots.get(serviceId)!;
    return snapshot.state === "stopped"
      ? { kind: "control", serviceId }
      : { kind: "control", serviceId, operation: "stop" };
  });
}

function planRestart(
  input: PlanRegisteredServiceOrchestrationInput,
): readonly OrchestrationStep[] {
  const dependents = input.graph.transitiveDependentsOf(input.targetServiceId);
  const activeDependents = dependents.filter((serviceId) => {
    const state = input.snapshots.get(serviceId)!.state;
    return state === "running" || state === "failed" || state === "unknown";
  });
  const stopOrder = input.graph.topologicalDependentsFirst(activeDependents);
  const restoreOrder = [...stopOrder].reverse();
  const steps: OrchestrationStep[] = stopOrder.map((serviceId) => ({
    kind: "control",
    serviceId,
    operation: "stop",
  }));

  steps.push(
    { kind: "control", serviceId: input.targetServiceId, operation: "restart" },
    { kind: "wait_for_readiness", serviceId: input.targetServiceId },
  );

  for (const serviceId of restoreOrder) {
    steps.push(
      { kind: "control", serviceId, operation: "start" },
      { kind: "wait_for_readiness", serviceId },
    );
  }

  return steps;
}

function validatePlannedOperations(
  input: PlanRegisteredServiceOrchestrationInput,
  steps: readonly OrchestrationStep[],
): void {
  const seen = new Set<string>();
  for (const step of steps) {
    const snapshot = input.snapshots.get(step.serviceId);
    if (!snapshot) throw new RegisteredServiceOrchestrationPlanError();
    const key = `${step.kind}:${step.serviceId}:${step.operation ?? ""}`;
    if (seen.has(key)) throw new RegisteredServiceOrchestrationPlanError();
    seen.add(key);
    if (
      step.operation &&
      !snapshot.supportedOperations.includes(step.operation)
    ) {
      throw new RegisteredServiceOrchestrationPlanError();
    }
  }
}
