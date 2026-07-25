import {
  SERVICE_AVAILABILITY_EXPECTATIONS,
  type ServiceAvailabilityExpectation,
} from "../../service-scheduling/domain/service-availability-policy-evaluator.js";
import type { ServiceControlOperation } from "./registered-service-control-result.js";
import {
  SERVICE_RUNTIME_STATES,
  type ServiceRuntimeState,
} from "./registered-service-status.js";

export type ServiceAvailabilityReconciliationOperation = Extract<
  ServiceControlOperation,
  "start" | "stop"
>;

export type ServiceAvailabilityReconciliationDecision =
  | Readonly<{
      kind: "execute";
      operation: ServiceAvailabilityReconciliationOperation;
    }>
  | Readonly<{
      kind: "none";
    }>;

export class ServiceAvailabilityReconciliationDecisionError extends Error {
  public override readonly name =
    "ServiceAvailabilityReconciliationDecisionError";

  public readonly code = "invalid_service_availability_reconciliation_input";

  public constructor() {
    super("Invalid service availability reconciliation input");
  }
}

const expectationAllowlist = new Set<string>(SERVICE_AVAILABILITY_EXPECTATIONS);
const runtimeStateAllowlist = new Set<string>(SERVICE_RUNTIME_STATES);

const START_DECISION = Object.freeze({
  kind: "execute",
  operation: "start",
} as const satisfies ServiceAvailabilityReconciliationDecision);

const STOP_DECISION = Object.freeze({
  kind: "execute",
  operation: "stop",
} as const satisfies ServiceAvailabilityReconciliationDecision);

const NO_OPERATION_DECISION = Object.freeze({
  kind: "none",
} as const satisfies ServiceAvailabilityReconciliationDecision);

export function decideServiceAvailabilityReconciliation(
  expectation: unknown,
  runtimeState: unknown,
): ServiceAvailabilityReconciliationDecision {
  if (
    typeof expectation !== "string" ||
    !expectationAllowlist.has(expectation) ||
    typeof runtimeState !== "string" ||
    !runtimeStateAllowlist.has(runtimeState)
  ) {
    throw new ServiceAvailabilityReconciliationDecisionError();
  }

  return decideValidatedReconciliation(
    expectation as ServiceAvailabilityExpectation,
    runtimeState as ServiceRuntimeState,
  );
}

function decideValidatedReconciliation(
  expectation: ServiceAvailabilityExpectation,
  runtimeState: ServiceRuntimeState,
): ServiceAvailabilityReconciliationDecision {
  if (expectation === "available" && runtimeState === "stopped") {
    return START_DECISION;
  }

  if (expectation === "unavailable" && runtimeState === "running") {
    return STOP_DECISION;
  }

  return NO_OPERATION_DECISION;
}
