import type { OrchestrationResult } from "../domain/orchestration-plan.js";
import type { ServiceAvailabilityReconciliationOccurrence } from "../domain/service-availability-reconciliation-occurrence.js";
import type { OrchestrateRegisteredServiceControlPort } from "./orchestrate-registered-service-control.js";
import type { PlanRegisteredServiceAvailabilityReconciliation } from "./plan-registered-service-availability-reconciliation.js";
import type { ServiceAvailabilityReconciliationOccurrenceClaimStore } from "./ports/service-availability-reconciliation-occurrence-claim-store.js";

export type ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult =
  | Readonly<{
      kind: "none";
    }>
  | Readonly<{
      kind: "duplicate";
    }>
  | Readonly<{
      kind: "executed";
      orchestrationResult: OrchestrationResult;
    }>;

const NO_OPERATION_RESULT = Object.freeze({
  kind: "none",
} as const satisfies ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult);

const DUPLICATE_RESULT = Object.freeze({
  kind: "duplicate",
} as const satisfies ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult);

export class ExecuteRegisteredServiceAvailabilityReconciliationOccurrence {
  public constructor(
    private readonly planner: PlanRegisteredServiceAvailabilityReconciliation,
    private readonly claimStore: ServiceAvailabilityReconciliationOccurrenceClaimStore,
    private readonly orchestrate: OrchestrateRegisteredServiceControlPort,
  ) {}

  public async execute(
    occurrence: ServiceAvailabilityReconciliationOccurrence,
  ): Promise<ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult> {
    const decision = await this.planner.execute(occurrence.serviceId);

    if (
      decision.kind === "none" ||
      decision.operation !== occurrence.operation
    ) {
      return NO_OPERATION_RESULT;
    }

    const claimResult = await this.claimStore.claim(occurrence);

    if (claimResult.kind === "duplicate") {
      return DUPLICATE_RESULT;
    }

    const orchestrationResult = await this.orchestrate.execute(
      occurrence.serviceId,
      occurrence.operation,
      "scheduled",
    );

    if (!orchestrationResult.successful) {
      throw new Error(
        `Orchestration failed for ${occurrence.serviceId}: ${occurrence.operation}`,
      );
    }

    return Object.freeze({
      kind: "executed",
      orchestrationResult,
    });
  }
}
