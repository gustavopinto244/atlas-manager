export const ADMINISTRATIVE_PERMISSIONS = Object.freeze([
  "power.wake.schedule",
  "power.wake.cancel",
  "power.shutdown.request",
  "power.shutdown.prepare",
  "power.shutdown.execute",
  "power.scheduler.tick",
  "event_history.read",
] as const);

export type AdministrativePermission =
  (typeof ADMINISTRATIVE_PERMISSIONS)[number];

export class AdministrativePermissionValidationError extends Error {
  public override readonly name = "AdministrativePermissionValidationError";
  public constructor(public readonly code: "invalid_permission") {
    super(`Invalid administrative permission: ${code}`);
    Object.freeze(this);
  }
}

export function createAdministrativePermission(
  input: unknown,
): AdministrativePermission {
  if (
    typeof input !== "string" ||
    !(ADMINISTRATIVE_PERMISSIONS as readonly string[]).includes(input)
  )
    throw new AdministrativePermissionValidationError("invalid_permission");
  return input as AdministrativePermission;
}
