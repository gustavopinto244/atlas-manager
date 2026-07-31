import type { ServiceAvailabilityOverride } from "../../service-scheduling/domain/service-availability-override.js";
import type { ServiceAvailabilityPolicy } from "../../service-scheduling/domain/service-availability-policy.js";
import { evaluateServiceAvailabilityWithOverride } from "../../service-scheduling/domain/service-availability-override-evaluator.js";

export type RegisteredServiceAvailabilityIntervalOutcome =
  "not_required" | "required";
export interface RegisteredServiceAvailabilityInterval {
  readonly serviceId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly outcome: RegisteredServiceAvailabilityIntervalOutcome;
  readonly firstRequiredAt?: string;
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
  if (policy.mode === "disabled" || policy.mode === "manual")
    return Object.freeze({
      serviceId,
      startsAt,
      endsAt,
      outcome: "not_required" as const,
    });
  if (override !== null && start < Date.parse(override.expiresAt)) {
    if (override.kind === "keep_available")
      return Object.freeze({
        serviceId,
        startsAt,
        endsAt,
        outcome: "required" as const,
        firstRequiredAt: startsAt,
      });
    const after = Math.max(start, Date.parse(override.expiresAt));
    const required = findRequiredAt(policy, after, end, override, false);
    return required === null
      ? Object.freeze({
          serviceId,
          startsAt,
          endsAt,
          outcome: "not_required" as const,
        })
      : Object.freeze({
          serviceId,
          startsAt,
          endsAt,
          outcome: "required" as const,
          firstRequiredAt: new Date(required).toISOString(),
        });
  }
  if (policy.mode === "always")
    return Object.freeze({
      serviceId,
      startsAt,
      endsAt,
      outcome: "required" as const,
      firstRequiredAt: startsAt,
    });
  const required = findRequiredAt(policy, start, end, null, true);
  return required === null
    ? Object.freeze({
        serviceId,
        startsAt,
        endsAt,
        outcome: "not_required" as const,
      })
    : Object.freeze({
        serviceId,
        startsAt,
        endsAt,
        outcome: "required" as const,
        firstRequiredAt: new Date(required).toISOString(),
      });
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
