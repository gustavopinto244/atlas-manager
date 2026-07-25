export type ServiceAvailabilityEvaluationErrorCode =
  "invalid_service_availability_instant";

export class ServiceAvailabilityEvaluationError extends Error {
  public override readonly name = "ServiceAvailabilityEvaluationError";
  public readonly code: ServiceAvailabilityEvaluationErrorCode =
    "invalid_service_availability_instant";

  public constructor() {
    super("Invalid service availability instant");
  }
}
