import { ServiceAvailabilityOverrideValidationError } from "./service-availability-override-validation-error.js";

export const SERVICE_AVAILABILITY_OVERRIDE_KINDS = Object.freeze([
  "keep_available",
  "suspend_schedule",
] as const);

export type ServiceAvailabilityOverrideKind =
  (typeof SERVICE_AVAILABILITY_OVERRIDE_KINDS)[number];

export interface CreateServiceAvailabilityOverrideInput {
  readonly kind: unknown;
  readonly expiresAt: unknown;
}

export interface ServiceAvailabilityOverride {
  readonly kind: ServiceAvailabilityOverrideKind;
  readonly expiresAt: string;
}

export function isSameServiceAvailabilityOverride(
  left: ServiceAvailabilityOverride,
  right: ServiceAvailabilityOverride,
): boolean {
  return left.kind === right.kind && left.expiresAt === right.expiresAt;
}

const OVERRIDE_FIELDS = Object.freeze(["kind", "expiresAt"] as const);
const overrideKindAllowlist = new Set<unknown>(
  SERVICE_AVAILABILITY_OVERRIDE_KINDS,
);

export function createServiceAvailabilityOverride(
  input: unknown,
  referenceInstant: Date,
): ServiceAvailabilityOverride {
  if (!hasExactOverrideShape(input)) {
    throw new ServiceAvailabilityOverrideValidationError(
      "invalid_service_availability_override",
    );
  }

  const kind = validateOverrideKind(input.kind);
  const expiration = validateExpiration(input.expiresAt);
  const referenceTimestamp = validateReferenceInstant(referenceInstant);

  if (expiration.timestamp <= referenceTimestamp) {
    throw new ServiceAvailabilityOverrideValidationError(
      "non_future_service_availability_override_expiration",
    );
  }

  return Object.freeze({ kind, expiresAt: expiration.canonicalValue });
}

function hasExactOverrideShape(
  input: unknown,
): input is CreateServiceAvailabilityOverrideInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const ownKeys = Reflect.ownKeys(input);

  return (
    ownKeys.length === OVERRIDE_FIELDS.length &&
    OVERRIDE_FIELDS.every((field) => Object.hasOwn(input, field)) &&
    ownKeys.every(
      (key) =>
        typeof key === "string" &&
        (OVERRIDE_FIELDS as readonly string[]).includes(key),
    )
  );
}

function validateOverrideKind(value: unknown): ServiceAvailabilityOverrideKind {
  if (typeof value !== "string" || !overrideKindAllowlist.has(value)) {
    throw new ServiceAvailabilityOverrideValidationError(
      "invalid_service_availability_override_kind",
    );
  }

  return value as ServiceAvailabilityOverrideKind;
}

function validateExpiration(value: unknown): {
  readonly canonicalValue: string;
  readonly timestamp: number;
} {
  if (typeof value !== "string") {
    throw new ServiceAvailabilityOverrideValidationError(
      "invalid_service_availability_override_expiration",
    );
  }

  const parsedExpiration = new Date(value);
  const timestamp = parsedExpiration.getTime();

  if (!Number.isFinite(timestamp) || parsedExpiration.toISOString() !== value) {
    throw new ServiceAvailabilityOverrideValidationError(
      "invalid_service_availability_override_expiration",
    );
  }

  return { canonicalValue: value, timestamp };
}

function validateReferenceInstant(referenceInstant: Date): number {
  if (!(referenceInstant instanceof Date)) {
    throw new ServiceAvailabilityOverrideValidationError(
      "invalid_service_availability_override_reference_instant",
    );
  }

  const timestamp = referenceInstant.getTime();

  if (!Number.isFinite(timestamp)) {
    throw new ServiceAvailabilityOverrideValidationError(
      "invalid_service_availability_override_reference_instant",
    );
  }

  return timestamp;
}
