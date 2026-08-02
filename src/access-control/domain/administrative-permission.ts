export const ADMINISTRATIVE_PERMISSIONS = Object.freeze([
  "power.wake.read",
  "power.wake.schedule",
  "power.wake.cancel",
  "power.shutdown.request",
  "power.shutdown.prepare",
  "power.shutdown.execute",
  "power.scheduler.tick",
  "event_history.read",
  "services.read",
  "services.start",
  "services.stop",
  "services.restart",
  "services.availability.read",
  "services.availability.write",
  "operations.read",
  "dashboard.read",
  "backups.targets.read",
  "backups.runs.read",
  "backups.run",
  "backups.schedule.read",
  "backups.schedule.write",
  "backups.retention.read",
  "backups.retention.write",
  "backups.retention.prune",
  "backups.scheduler.tick",
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
