export const SERVICE_AVAILABILITY_MODES = Object.freeze([
  "always",
  "scheduled",
  "manual",
  "disabled",
] as const);

export type ServiceAvailabilityMode =
  (typeof SERVICE_AVAILABILITY_MODES)[number];

export type ServiceAvailabilityModeValidationErrorCode =
  "invalid_availability_mode";

export class ServiceAvailabilityModeValidationError extends Error {
  public override readonly name = "ServiceAvailabilityModeValidationError";

  public constructor(
    public readonly code: ServiceAvailabilityModeValidationErrorCode,
  ) {
    super(`Invalid service availability mode: ${code}`);
  }
}

const availabilityModeAllowlist = new Set<unknown>(SERVICE_AVAILABILITY_MODES);

export function createServiceAvailabilityMode(
  value: string,
): ServiceAvailabilityMode {
  if (!availabilityModeAllowlist.has(value)) {
    throw new ServiceAvailabilityModeValidationError(
      "invalid_availability_mode",
    );
  }

  return value as ServiceAvailabilityMode;
}
