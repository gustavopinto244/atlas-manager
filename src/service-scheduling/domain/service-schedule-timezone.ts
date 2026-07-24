export const SERVICE_SCHEDULE_TIMEZONES = Object.freeze([
  "America/Sao_Paulo",
] as const);

export type ServiceScheduleTimezone =
  (typeof SERVICE_SCHEDULE_TIMEZONES)[number];

export type ServiceScheduleTimezoneValidationErrorCode =
  "invalid_schedule_timezone";

export class ServiceScheduleTimezoneValidationError extends Error {
  public override readonly name = "ServiceScheduleTimezoneValidationError";
  public readonly code: ServiceScheduleTimezoneValidationErrorCode =
    "invalid_schedule_timezone";

  public constructor() {
    super("Invalid service schedule timezone");
  }
}

const timezoneAllowlist = new Set<unknown>(SERVICE_SCHEDULE_TIMEZONES);

export function createServiceScheduleTimezone(
  value: string,
): ServiceScheduleTimezone {
  if (!timezoneAllowlist.has(value)) {
    throw new ServiceScheduleTimezoneValidationError();
  }

  return value as ServiceScheduleTimezone;
}
