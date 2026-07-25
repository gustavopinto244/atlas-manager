export type ServiceAvailabilityPolicyValidationErrorCode =
  "invalid_service_availability_policy";

export class ServiceAvailabilityPolicyValidationError extends Error {
  public override readonly name = "ServiceAvailabilityPolicyValidationError";
  public readonly code: ServiceAvailabilityPolicyValidationErrorCode =
    "invalid_service_availability_policy";

  public constructor() {
    super("Invalid service availability policy");
  }
}
