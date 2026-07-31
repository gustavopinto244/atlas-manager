import type { Clock } from "./ports/clock.js";
import type { ServiceController } from "./ports/service-controller.js";
import type { ServiceStatusReader } from "./ports/service-status-reader.js";
import type { ControlRegisteredService } from "./control-registered-service.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { GetRegisteredServiceEffectiveAvailabilityPort } from "./get-registered-service-effective-availability.js";
import {
  type OrchestrationResult,
  type CompletedOrchestrationStep,
  createOrchestrationResult,
} from "../domain/orchestration-plan.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";
import type { WaitForRegisteredServiceReadinessPort } from "./wait-for-registered-service-readiness.js";
import type { RegisteredServiceDependencyGraph } from "../domain/dependency-graph.js";
import {
  DefaultPlanRegisteredServiceOrchestration,
  getCandidateServiceIds,
  RegisteredServiceOrchestrationPlanError,
  RegisteredServiceOrchestrationStatusError,
  type OrchestrationAuthority,
  type PlanRegisteredServiceOrchestration,
  type RegisteredServiceOrchestrationOperation,
  type RegisteredServiceRuntimeSnapshot,
} from "./plan-registered-service-orchestration.js";

export class OrchestrationOperationNotSupportedError extends Error {
  public constructor(serviceId: string, operation: string) {
    super(
      `Orchestration operation not supported: ${operation} for ${serviceId}`,
    );
    this.name = "OrchestrationOperationNotSupportedError";
    Object.freeze(this);
  }
}

export class UnavailableDependencyBlockedError extends Error {
  public readonly unavailableDependencyId: string;

  public constructor(unavailableDependencyId: string) {
    super(
      `Dependency is unavailable and blocks orchestration: ${unavailableDependencyId}`,
    );
    this.name = "UnavailableDependencyBlockedError";
    this.unavailableDependencyId = unavailableDependencyId;
    Object.freeze(this);
  }
}

export class OrchestrationPlanInvalidError extends Error {
  public constructor() {
    super("Orchestration plan is invalid");
    this.name = "OrchestrationPlanInvalidError";
    Object.freeze(this);
  }
}

export interface OrchestrateRegisteredServiceControlPort {
  readonly execute: (
    targetServiceId: string,
    operation: RegisteredServiceOrchestrationOperation,
    authority?: OrchestrationAuthority,
  ) => Promise<OrchestrationResult>;
}

export class OrchestrateRegisteredServiceControl implements OrchestrateRegisteredServiceControlPort {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly controller: ServiceController,
    private readonly getGraph: () => Promise<RegisteredServiceDependencyGraph>,
    private readonly waitForReadiness: WaitForRegisteredServiceReadinessPort,
    private readonly clock: Clock,
    private readonly getEffectiveAvailability: GetRegisteredServiceEffectiveAvailabilityPort,
    private readonly statusReader?: ServiceStatusReader,
    private readonly directControl?: ControlRegisteredService,
    private readonly planner: PlanRegisteredServiceOrchestration = new DefaultPlanRegisteredServiceOrchestration(),
  ) {}

  public async execute(
    targetServiceId: string,
    operation: RegisteredServiceOrchestrationOperation,
    authority: OrchestrationAuthority = "manual",
  ): Promise<OrchestrationResult> {
    const target = await this.catalog.findById(targetServiceId);
    if (!target) {
      throw new RegisteredServiceNotFoundError();
    }

    const startedAt = this.clock.now().toISOString();
    const graph = await this.getGraph();

    if (operation === "start" && authority === "scheduled") {
      await this.validateScheduledDependencyAvailability(
        targetServiceId,
        graph,
      );
    }

    const snapshots = await this.captureSnapshots(
      targetServiceId,
      operation,
      graph,
    );

    let plan;
    try {
      plan = this.planner.execute({
        targetServiceId,
        operation,
        graph,
        snapshots,
      });
    } catch (error) {
      return this.createFailedResult(
        targetServiceId,
        operation,
        startedAt,
        error,
      );
    }

    const completedSteps: CompletedOrchestrationStep[] = [];

    for (const step of plan.steps) {
      try {
        if (step.kind === "wait_for_readiness") {
          const readiness = await this.waitForReadiness.execute(step.serviceId);
          completedSteps.push({
            serviceId: step.serviceId,
            kind: step.kind,
            outcome: {
              kind: "ready",
              observedAt:
                readiness && typeof readiness === "object"
                  ? readiness.observedAt
                  : this.clock.now().toISOString(),
            },
          });
          continue;
        }

        if (step.operation) {
          await this.executeControl(step.serviceId, step.operation);
          completedSteps.push({
            serviceId: step.serviceId,
            kind: step.kind,
            operation: step.operation,
            outcome: {
              kind: "executed",
              completedAt: this.clock.now().toISOString(),
            },
          });
          continue;
        }

        completedSteps.push({
          serviceId: step.serviceId,
          kind: step.kind,
          outcome: {
            kind: "skipped",
            reason: "already_stopped",
          },
        });
      } catch (error) {
        const failedStep: CompletedOrchestrationStep = {
          serviceId: step.serviceId,
          kind: step.kind,
          ...(step.operation ? { operation: step.operation } : {}),
          outcome: {
            kind: "failed",
            error: sanitizeOrchestrationError(error),
          },
        };
        completedSteps.push(failedStep);
        break;
      }
    }

    const successful = !completedSteps.some(
      (step) => step.outcome.kind === "failed",
    );

    return createOrchestrationResult({
      targetServiceId,
      requestedOperation: operation,
      startedAt,
      completedAt: this.clock.now().toISOString(),
      steps: completedSteps,
      successful,
    });
  }

  private async captureSnapshots(
    targetServiceId: string,
    operation: RegisteredServiceOrchestrationOperation,
    graph: RegisteredServiceDependencyGraph,
  ): Promise<ReadonlyMap<string, RegisteredServiceRuntimeSnapshot>> {
    const snapshots = new Map<string, RegisteredServiceRuntimeSnapshot>();
    const serviceIds = getCandidateServiceIds({
      targetServiceId,
      operation,
      graph,
    });

    for (const serviceId of serviceIds) {
      const service = await this.catalog.findById(serviceId);
      if (!service) {
        throw new RegisteredServiceNotFoundError();
      }

      const state = this.statusReader
        ? await this.readRuntimeState(serviceId)
        : fallbackState(operation);
      snapshots.set(
        serviceId,
        Object.freeze({
          serviceId,
          state,
          supportedOperations: Object.freeze([...service.supportedOperations]),
        }),
      );
    }

    return snapshots;
  }

  private async validateScheduledDependencyAvailability(
    targetServiceId: string,
    graph: RegisteredServiceDependencyGraph,
  ): Promise<void> {
    for (const dependencyId of graph.transitiveDependenciesOf(
      targetServiceId,
    )) {
      const availability =
        await this.getEffectiveAvailability.execute(dependencyId);
      if (availability === "unavailable" || availability === "disabled") {
        throw new UnavailableDependencyBlockedError(dependencyId);
      }
    }
  }

  private async executeControl(
    serviceId: string,
    operation: RegisteredServiceOrchestrationOperation,
  ): Promise<void> {
    const service = await this.catalog.findById(serviceId);
    if (!service) {
      throw new RegisteredServiceNotFoundError();
    }

    if (!service.supportedOperations.includes(operation)) {
      throw new OrchestrationOperationNotSupportedError(serviceId, operation);
    }

    if (this.directControl) {
      await this.directControl.execute(serviceId, operation);
      return;
    }
    await this.controller.execute(service, operation);
  }

  private async readRuntimeState(
    serviceId: string,
  ): Promise<RegisteredServiceRuntimeSnapshot["state"]> {
    const service = await this.catalog.findById(serviceId);
    if (!service) {
      throw new RegisteredServiceNotFoundError();
    }

    try {
      return await this.statusReader!.read(service);
    } catch {
      throw new RegisteredServiceOrchestrationStatusError(serviceId);
    }
  }

  private createFailedResult(
    targetServiceId: string,
    operation: RegisteredServiceOrchestrationOperation,
    startedAt: string,
    error: unknown,
  ): OrchestrationResult {
    return createOrchestrationResult({
      targetServiceId,
      requestedOperation: operation,
      startedAt,
      completedAt: this.clock.now().toISOString(),
      steps: [
        {
          serviceId: targetServiceId,
          kind: "control",
          operation,
          outcome: {
            kind: "failed",
            error: sanitizeOrchestrationError(error),
          },
        },
      ],
      successful: false,
    });
  }
}

function fallbackState(
  operation: RegisteredServiceOrchestrationOperation,
): RegisteredServiceRuntimeSnapshot["state"] {
  if (operation === "start") return "stopped";
  return "running";
}

function sanitizeOrchestrationError(error: unknown): string {
  if (
    error instanceof OrchestrationPlanInvalidError ||
    error instanceof RegisteredServiceOrchestrationPlanError
  ) {
    return "plan_invalid";
  }
  if (error instanceof UnavailableDependencyBlockedError) {
    return "dependency_unavailable";
  }
  if (error instanceof OrchestrationOperationNotSupportedError) {
    return "operation_not_supported";
  }
  if (error instanceof RegisteredServiceOrchestrationStatusError) {
    return "dependency_status_failed";
  }
  if (
    error instanceof Error &&
    error.name === "RegisteredServiceReadinessTimeoutError"
  ) {
    return "dependency_readiness_timeout";
  }
  return "orchestration_step_failed";
}
