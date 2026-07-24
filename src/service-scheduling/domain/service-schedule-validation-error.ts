export type ServiceScheduleValidationErrorCode =
  | "invalid_schedule_weekday"
  | "invalid_schedule_local_time"
  | "invalid_weekly_availability_window"
  | "empty_weekly_availability_schedule"
  | "weekly_availability_schedule_limit_exceeded"
  | "overlapping_weekly_availability_windows";

export class ServiceScheduleValidationError extends Error {
  public override readonly name = "ServiceScheduleValidationError";

  public constructor(public readonly code: ServiceScheduleValidationErrorCode) {
    super(`Invalid service schedule: ${code}`);
  }
}
