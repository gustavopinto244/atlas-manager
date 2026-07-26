import {
  evaluateServiceAvailabilityPolicy,
  type ServiceAvailabilityExpectation,
} from "./service-availability-policy-evaluator.js";
import type { ServiceAvailabilityPolicy } from "./service-availability-policy.js";
import type { ServiceAvailabilityPolicyTransition } from "./service-availability-policy-transition.js";
import { ServiceAvailabilityTransitionCalculationError } from "./service-availability-transition-calculation-error.js";

const MINUTE_IN_MILLISECONDS = 60_000;
const MAXIMUM_INTERVAL_IN_MILLISECONDS = 8 * 24 * 60 * MINUTE_IN_MILLISECONDS;
const EMPTY_TRANSITIONS = Object.freeze(
  [] as ServiceAvailabilityPolicyTransition[],
);

export function calculateServiceAvailabilityPolicyTransitions(
  policy: ServiceAvailabilityPolicy,
  fromExclusive: Date,
  toInclusive: Date,
): readonly ServiceAvailabilityPolicyTransition[] {
  const { fromTimestamp, toTimestamp } = validateInterval(
    fromExclusive,
    toInclusive,
  );

  if (policy.mode !== "scheduled") {
    return EMPTY_TRANSITIONS;
  }

  const transitions: ServiceAvailabilityPolicyTransition[] = [];
  let previousExpectation = evaluateServiceAvailabilityPolicy(
    policy,
    fromExclusive,
  );

  for (
    let timestamp = fromTimestamp + MINUTE_IN_MILLISECONDS;
    timestamp <= toTimestamp;
    timestamp += MINUTE_IN_MILLISECONDS
  ) {
    const instant = new Date(timestamp);
    const expectation = evaluateServiceAvailabilityPolicy(policy, instant);

    if (expectation !== previousExpectation) {
      transitions.push(createTransition(expectation, instant));
      previousExpectation = expectation;
    }
  }

  return Object.freeze(transitions);
}

function validateInterval(
  fromExclusive: unknown,
  toInclusive: unknown,
): Readonly<{
  fromTimestamp: number;
  toTimestamp: number;
}> {
  if (!(fromExclusive instanceof Date) || !(toInclusive instanceof Date)) {
    throw new ServiceAvailabilityTransitionCalculationError(
      "invalid_transition_interval",
    );
  }

  const fromTimestamp = fromExclusive.getTime();
  const toTimestamp = toInclusive.getTime();

  if (
    !Number.isFinite(fromTimestamp) ||
    !Number.isFinite(toTimestamp) ||
    toTimestamp <= fromTimestamp
  ) {
    throw new ServiceAvailabilityTransitionCalculationError(
      "invalid_transition_interval",
    );
  }

  if (
    fromExclusive.getUTCSeconds() !== 0 ||
    fromExclusive.getUTCMilliseconds() !== 0 ||
    toInclusive.getUTCSeconds() !== 0 ||
    toInclusive.getUTCMilliseconds() !== 0
  ) {
    throw new ServiceAvailabilityTransitionCalculationError(
      "transition_interval_not_minute_aligned",
    );
  }

  if (toTimestamp - fromTimestamp > MAXIMUM_INTERVAL_IN_MILLISECONDS) {
    throw new ServiceAvailabilityTransitionCalculationError(
      "transition_interval_limit_exceeded",
    );
  }

  return { fromTimestamp, toTimestamp };
}

function createTransition(
  expectation: ServiceAvailabilityExpectation,
  instant: Date,
): ServiceAvailabilityPolicyTransition {
  return Object.freeze({
    kind:
      expectation === "available" ? "became_available" : "became_unavailable",
    scheduledFor: instant.toISOString(),
  });
}
