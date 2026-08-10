import type { ServiceAvailabilityOverride } from "../../service-scheduling/domain/service-availability-override.js";
import type { ServiceAvailabilityPolicy } from "../../service-scheduling/domain/service-availability-policy.js";
import { evaluateServiceAvailabilityWithOverride } from "../../service-scheduling/domain/service-availability-override-evaluator.js";
import { calculateServiceAvailabilityPolicyTransitions } from "../../service-scheduling/domain/service-availability-policy-transition-calculator.js";
import type { ServiceAvailabilityPolicyTransition } from "../../service-scheduling/domain/service-availability-policy-transition.js";

// Bounds how many upcoming transitions ride along on an interval evaluation
// -- this is an operator-facing "what happens next" hint, not the full
// transition list, so it stays small regardless of interval length.
const MAX_RENDERED_TRANSITIONS = 5;

export type RegisteredServiceAvailabilityIntervalOutcome =
  "not_required" | "required";
export interface RegisteredServiceAvailabilityInterval {
  readonly serviceId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly outcome: RegisteredServiceAvailabilityIntervalOutcome;
  readonly firstRequiredAt?: string;
  readonly transitions?: readonly ServiceAvailabilityPolicyTransition[];
}
export class RegisteredServiceAvailabilityIntervalValidationError extends Error {
  public override readonly name =
    "RegisteredServiceAvailabilityIntervalValidationError";
  public constructor(
    public readonly code:
      "invalid_interval" | "invalid_service_id" | "invalid_combination",
  ) {
    super(`Invalid registered-service availability interval: ${code}`);
    Object.freeze(this);
  }
}

export function evaluateRegisteredServiceAvailabilityForInterval(
  serviceId: string,
  policy: ServiceAvailabilityPolicy,
  override: ServiceAvailabilityOverride | null,
  startsAt: string,
  endsAt: string,
): RegisteredServiceAvailabilityInterval {
  if (!isServiceId(serviceId))
    throw new RegisteredServiceAvailabilityIntervalValidationError(
      "invalid_service_id",
    );
  if (
    !isCanonicalTimestamp(startsAt) ||
    !isCanonicalTimestamp(endsAt) ||
    Date.parse(startsAt) >= Date.parse(endsAt) ||
    Date.parse(endsAt) - Date.parse(startsAt) > 8 * 24 * 60 * 60 * 1000
  )
    throw new RegisteredServiceAvailabilityIntervalValidationError(
      "invalid_interval",
    );
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const transitions = computeUpcomingTransitions(policy, startsAt, endsAt);
  if (policy.mode === "disabled" || policy.mode === "manual")
    return Object.freeze({
      serviceId,
      startsAt,
      endsAt,
      outcome: "not_required" as const,
      ...withTransitions(transitions),
    });
  if (override !== null && start < Date.parse(override.expiresAt)) {
    if (override.kind === "keep_available")
      return Object.freeze({
        serviceId,
        startsAt,
        endsAt,
        outcome: "required" as const,
        firstRequiredAt: startsAt,
        ...withTransitions(transitions),
      });
    const after = Math.max(start, Date.parse(override.expiresAt));
    const required = findRequiredAt(policy, after, end, override, false);
    return required === null
      ? Object.freeze({
          serviceId,
          startsAt,
          endsAt,
          outcome: "not_required" as const,
          ...withTransitions(transitions),
        })
      : Object.freeze({
          serviceId,
          startsAt,
          endsAt,
          outcome: "required" as const,
          firstRequiredAt: new Date(required).toISOString(),
          ...withTransitions(transitions),
        });
  }
  if (policy.mode === "always")
    return Object.freeze({
      serviceId,
      startsAt,
      endsAt,
      outcome: "required" as const,
      firstRequiredAt: startsAt,
      ...withTransitions(transitions),
    });
  const required = findRequiredAt(policy, start, end, null, true);
  return required === null
    ? Object.freeze({
        serviceId,
        startsAt,
        endsAt,
        outcome: "not_required" as const,
        ...withTransitions(transitions),
      })
    : Object.freeze({
        serviceId,
        startsAt,
        endsAt,
        outcome: "required" as const,
        firstRequiredAt: new Date(required).toISOString(),
        ...withTransitions(transitions),
      });
}

function withTransitions(
  transitions: readonly ServiceAvailabilityPolicyTransition[],
): Readonly<{
  transitions?: readonly ServiceAvailabilityPolicyTransition[];
}> {
  return transitions.length === 0 ? {} : { transitions };
}

// Reuses the same policy-transition calculator the standalone transitions
// endpoint is built on, bounded to a small preview so an interval response
// stays a "what's coming up" hint rather than a full transition dump. Any
// rejection from the calculator (e.g. sub-minute alignment after rounding)
// degrades to an empty list instead of failing the whole interval read --
// this field is supplementary, the outcome/firstRequiredAt fields remain
// authoritative.
function computeUpcomingTransitions(
  policy: ServiceAvailabilityPolicy,
  startsAt: string,
  endsAt: string,
): readonly ServiceAvailabilityPolicyTransition[] {
  if (policy.mode !== "scheduled") return [];
  try {
    const from = floorToMinute(new Date(startsAt));
    const to = ceilToMinute(new Date(endsAt));
    if (to.getTime() <= from.getTime()) return [];
    return calculateServiceAvailabilityPolicyTransitions(
      policy,
      from,
      to,
    ).slice(0, MAX_RENDERED_TRANSITIONS);
  } catch {
    return [];
  }
}

function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

function ceilToMinute(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / 60_000) * 60_000);
}

function findRequiredAt(
  policy: ServiceAvailabilityPolicy,
  start: number,
  end: number,
  override: ServiceAvailabilityOverride | null,
  evaluateBase: boolean,
): number | null {
  const first = start;
  if (evaluateBase && policy.mode === "always") return first;
  const candidate = Math.ceil(start / 60_000) * 60_000;
  for (let instant = first; instant < end; instant += 60_000) {
    const point = instant === first ? first : Math.max(instant, candidate);
    if (point >= end) break;
    const expectation =
      override !== null && point < Date.parse(override.expiresAt)
        ? "manual"
        : evaluateServiceAvailabilityWithOverride(
            policy,
            null,
            new Date(point),
          );
    if (expectation === "available") return point;
  }
  return null;
}
function isServiceId(value: string): boolean {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}
function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
