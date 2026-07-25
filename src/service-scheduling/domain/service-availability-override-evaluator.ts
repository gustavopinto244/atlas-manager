import { ServiceAvailabilityEvaluationError } from "./service-availability-evaluation-error.js";
import type { ServiceAvailabilityOverride } from "./service-availability-override.js";
import type { ServiceAvailabilityPolicy } from "./service-availability-policy.js";
import {
  evaluateServiceAvailabilityPolicy,
  type ServiceAvailabilityExpectation,
} from "./service-availability-policy-evaluator.js";

export function evaluateServiceAvailabilityWithOverride(
  policy: ServiceAvailabilityPolicy,
  override: ServiceAvailabilityOverride | null,
  instant: Date,
): ServiceAvailabilityExpectation {
  if (!(instant instanceof Date)) {
    throw new ServiceAvailabilityEvaluationError();
  }

  const evaluationTimestamp = instant.getTime();

  if (!Number.isFinite(evaluationTimestamp)) {
    throw new ServiceAvailabilityEvaluationError();
  }

  if (
    override === null ||
    evaluationTimestamp >= Date.parse(override.expiresAt)
  ) {
    return evaluateServiceAvailabilityPolicy(
      policy,
      new Date(evaluationTimestamp),
    );
  }

  if (policy.mode === "disabled") {
    return "disabled";
  }

  switch (override.kind) {
    case "keep_available":
      return "available";
    case "suspend_schedule":
      return "manual";
  }
}
