import type { RegisteredServiceControlResult } from "../domain/registered-service-control-result.js";
import type { ControlRegisteredService } from "./control-registered-service.js";
import type { PlanRegisteredServiceAvailabilityReconciliation } from "./plan-registered-service-availability-reconciliation.js";

export type ExecuteRegisteredServiceAvailabilityReconciliationResult =
  | Readonly<{
      kind: "none";
    }>
  | Readonly<{
      kind: "executed";
      controlResult: RegisteredServiceControlResult;
    }>;

const NO_OPERATION_RESULT = Object.freeze({
  kind: "none",
} as const satisfies ExecuteRegisteredServiceAvailabilityReconciliationResult);

export class ExecuteRegisteredServiceAvailabilityReconciliation {
  public constructor(
    private readonly planner: PlanRegisteredServiceAvailabilityReconciliation,
    private readonly controlRegisteredService: ControlRegisteredService,
  ) {}

  public async execute(
    serviceId: string,
  ): Promise<ExecuteRegisteredServiceAvailabilityReconciliationResult> {
    const decision = await this.planner.execute(serviceId);

    if (decision.kind === "none") {
      return NO_OPERATION_RESULT;
    }

    const controlResult = await this.controlRegisteredService.execute(
      serviceId,
      decision.operation,
    );

    return Object.freeze({
      kind: "executed",
      controlResult,
    });
  }
}
