export type ServiceAvailabilityTransitionCalculationErrorCode =
  | "invalid_transition_interval"
  | "transition_interval_not_minute_aligned"
  | "transition_interval_limit_exceeded";

export class ServiceAvailabilityTransitionCalculationError extends Error {
  public override readonly name =
    "ServiceAvailabilityTransitionCalculationError";

  public constructor(
    public readonly code: ServiceAvailabilityTransitionCalculationErrorCode,
  ) {
    super(`Service availability transition calculation failed: ${code}`);
  }
}
