export type ServiceAvailabilityOverrideValidationErrorCode =
  | "invalid_service_availability_override"
  | "invalid_service_availability_override_kind"
  | "invalid_service_availability_override_expiration"
  | "invalid_service_availability_override_reference_instant"
  | "non_future_service_availability_override_expiration";

export class ServiceAvailabilityOverrideValidationError extends Error {
  public override readonly name = "ServiceAvailabilityOverrideValidationError";

  public constructor(
    public readonly code: ServiceAvailabilityOverrideValidationErrorCode,
  ) {
    super(`Invalid service availability override: ${code}`);
  }
}
