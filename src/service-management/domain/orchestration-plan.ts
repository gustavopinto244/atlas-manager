export type OrchestrationStepKind = "control" | "wait_for_readiness";

export type OrchestrationStep = Readonly<{
  kind: OrchestrationStepKind;
  serviceId: string;
  operation?: "start" | "stop" | "restart";
}>;

export type OrchestrationStepOutcome =
  | Readonly<{ kind: "executed"; completedAt: string }>
  | Readonly<{ kind: "skipped"; reason: string }>
  | Readonly<{ kind: "ready"; observedAt: string }>
  | Readonly<{ kind: "failed"; error: string }>;

export type CompletedOrchestrationStep = Readonly<{
  serviceId: string;
  kind: OrchestrationStepKind;
  operation?: "start" | "stop" | "restart";
  outcome: OrchestrationStepOutcome;
}>;

export interface OrchestrationPlan {
  readonly targetServiceId: string;
  readonly requestedOperation: "start" | "stop" | "restart";
  readonly steps: readonly OrchestrationStep[];
}

export interface OrchestrationResult {
  readonly targetServiceId: string;
  readonly requestedOperation: "start" | "stop" | "restart";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly steps: readonly CompletedOrchestrationStep[];
  readonly successful: boolean;
}

export function createOrchestrationPlan(params: {
  targetServiceId: string;
  requestedOperation: "start" | "stop" | "restart";
  steps: readonly OrchestrationStep[];
}): OrchestrationPlan {
  return Object.freeze({
    targetServiceId: params.targetServiceId,
    requestedOperation: params.requestedOperation,
    steps: Object.freeze(
      params.steps.map((step) => Object.freeze({ ...step })),
    ),
  });
}

export function createOrchestrationResult(params: {
  targetServiceId: string;
  requestedOperation: "start" | "stop" | "restart";
  startedAt: string;
  completedAt: string;
  steps: readonly CompletedOrchestrationStep[];
  successful: boolean;
}): OrchestrationResult {
  return Object.freeze({
    targetServiceId: params.targetServiceId,
    requestedOperation: params.requestedOperation,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    steps: Object.freeze(
      params.steps.map((step) =>
        Object.freeze({
          ...step,
          outcome: Object.freeze({ ...step.outcome }),
        }),
      ),
    ),
    successful: params.successful,
  });
}
