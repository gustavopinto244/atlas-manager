import { ServiceAvailabilityEvaluationError } from "./service-availability-evaluation-error.js";
import type { ServiceAvailabilityOverride } from "./service-availability-override.js";
import type { ServiceAvailabilityPolicy } from "./service-availability-policy.js";
import {
  evaluateServiceAvailabilityPolicy,
  type ServiceAvailabilityExpectation,
} from "./service-availability-policy-evaluator.js";

export function getServiceAvailabilityEvaluationTimestamp(
  instant: Date,
): number {
  if (!(instant instanceof Date)) {
    throw new ServiceAvailabilityEvaluationError();
  }

  const evaluationTimestamp = instant.getTime();

  if (!Number.isFinite(evaluationTimestamp)) {
    throw new ServiceAvailabilityEvaluationError();
  }

  return evaluationTimestamp;
}

export function isServiceAvailabilityOverrideExpiredAt(
  override: ServiceAvailabilityOverride,
  instant: Date,
): boolean {
  return isServiceAvailabilityOverrideExpiredAtTimestamp(
    override,
    getServiceAvailabilityEvaluationTimestamp(instant),
  );
}

export function evaluateServiceAvailabilityWithOverride(
  policy: ServiceAvailabilityPolicy,
  override: ServiceAvailabilityOverride | null,
  instant: Date,
): ServiceAvailabilityExpectation {
  const evaluationTimestamp =
    getServiceAvailabilityEvaluationTimestamp(instant);

  if (
    override === null ||
    isServiceAvailabilityOverrideExpiredAtTimestamp(
      override,
      evaluationTimestamp,
    )
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

function isServiceAvailabilityOverrideExpiredAtTimestamp(
  override: ServiceAvailabilityOverride,
  evaluationTimestamp: number,
): boolean {
  return evaluationTimestamp >= Date.parse(override.expiresAt);
}
