import type { AdministrativePermission } from "./administrative-permission.js";
import type { AdministrativeRole } from "./administrative-role.js";

export const ADMINISTRATIVE_OPERATIONS = Object.freeze([
  "read_wake_alarm",
  "schedule_wake_alarm",
  "cancel_wake_alarm",
  "request_machine_shutdown",
  "prepare_machine_shutdown_occurrence",
  "execute_machine_shutdown_occurrence",
  "run_machine_power_scheduler_tick",
  "read_administrative_event_history",
  "read_registered_services",
  "read_registered_service",
  "start_registered_service",
  "stop_registered_service",
  "restart_registered_service",
  "read_registered_service_availability",
  "update_registered_service_availability",
  "remove_registered_service_availability",
  "read_operations_overview",
  "read_administrative_dashboard",
  "read_administrative_security_posture",
  "read_registered_backup_targets",
  "read_registered_backup_target",
  "read_backup_runs",
  "read_backup_run",
  "run_registered_backup",
  "read_backup_schedule",
  "update_backup_schedule",
  "remove_backup_schedule",
  "read_backup_retention",
  "update_backup_retention",
  "run_backup_retention_prune",
  "run_backup_scheduler_tick",
  "verify_event_history_integrity",
  "rotate_event_history",
  "read_event_history_retention",
  "update_event_history_retention",
  "prune_event_history",
  "list_event_history_exports",
  "read_event_history_export",
  "create_event_history_export",
  "download_event_history_export",
  "prune_event_history_exports",
] as const);

export type AdministrativeOperation =
  (typeof ADMINISTRATIVE_OPERATIONS)[number];

export const ADMINISTRATIVE_ROLE_PERMISSIONS: Readonly<
  Record<AdministrativeRole, readonly AdministrativePermission[]>
> = Object.freeze({
  power_operator: Object.freeze([
    "power.wake.read",
    "power.wake.schedule",
    "power.wake.cancel",
    "power.shutdown.request",
    "power.shutdown.prepare",
    "power.shutdown.execute",
    "operations.read",
    "dashboard.read",
  ] as AdministrativePermission[]),
  scheduler_operator: Object.freeze([
    "power.scheduler.tick",
    "operations.read",
    "dashboard.read",
  ] as AdministrativePermission[]),
  auditor: Object.freeze([
    "event_history.read",
    "event_history.integrity.read",
    "event_history.exports.read",
    "event_history.exports.create",
    "event_history.exports.download",
    "operations.read",
    "dashboard.read",
    "backups.targets.read",
    "backups.runs.read",
    "security.posture.read",
  ] as AdministrativePermission[]),
  service_operator: Object.freeze([
    "services.read",
    "services.start",
    "services.stop",
    "services.restart",
    "services.availability.read",
    "services.availability.write",
    "operations.read",
    "dashboard.read",
  ] as AdministrativePermission[]),
  backup_operator: Object.freeze([
    "backups.targets.read",
    "backups.runs.read",
    "backups.run",
    "backups.schedule.read",
    "backups.schedule.write",
    "backups.retention.read",
    "backups.retention.write",
    "backups.retention.prune",
    "backups.scheduler.tick",
    "operations.read",
    "dashboard.read",
  ] as AdministrativePermission[]),
  audit_operator: Object.freeze([
    "event_history.read",
    "event_history.integrity.read",
    "event_history.rotation.run",
    "event_history.retention.read",
    "event_history.retention.write",
    "event_history.retention.prune",
    "event_history.exports.read",
    "event_history.exports.create",
    "event_history.exports.download",
    "event_history.exports.prune",
    "operations.read",
    "dashboard.read",
    "security.posture.read",
  ] as AdministrativePermission[]),
  administrator: Object.freeze([
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
    "security.posture.read",
    "backups.targets.read",
    "backups.runs.read",
    "backups.run",
    "backups.schedule.read",
    "backups.schedule.write",
    "backups.retention.read",
    "backups.retention.write",
    "backups.retention.prune",
    "backups.scheduler.tick",
    "event_history.integrity.read",
    "event_history.rotation.run",
    "event_history.retention.read",
    "event_history.retention.write",
    "event_history.retention.prune",
    "event_history.exports.read",
    "event_history.exports.create",
    "event_history.exports.download",
    "event_history.exports.prune",
  ] as AdministrativePermission[]),
});

const OPERATION_PERMISSIONS: Readonly<
  Record<AdministrativeOperation, AdministrativePermission>
> = Object.freeze({
  read_wake_alarm: "power.wake.read",
  schedule_wake_alarm: "power.wake.schedule",
  cancel_wake_alarm: "power.wake.cancel",
  request_machine_shutdown: "power.shutdown.request",
  prepare_machine_shutdown_occurrence: "power.shutdown.prepare",
  execute_machine_shutdown_occurrence: "power.shutdown.execute",
  run_machine_power_scheduler_tick: "power.scheduler.tick",
  read_administrative_event_history: "event_history.read",
  read_registered_services: "services.read",
  read_registered_service: "services.read",
  start_registered_service: "services.start",
  stop_registered_service: "services.stop",
  restart_registered_service: "services.restart",
  read_registered_service_availability: "services.availability.read",
  update_registered_service_availability: "services.availability.write",
  remove_registered_service_availability: "services.availability.write",
  read_operations_overview: "operations.read",
  read_administrative_dashboard: "dashboard.read",
  read_administrative_security_posture: "security.posture.read",
  read_registered_backup_targets: "backups.targets.read",
  read_registered_backup_target: "backups.targets.read",
  read_backup_runs: "backups.runs.read",
  read_backup_run: "backups.runs.read",
  run_registered_backup: "backups.run",
  read_backup_schedule: "backups.schedule.read",
  update_backup_schedule: "backups.schedule.write",
  remove_backup_schedule: "backups.schedule.write",
  read_backup_retention: "backups.retention.read",
  update_backup_retention: "backups.retention.write",
  run_backup_retention_prune: "backups.retention.prune",
  run_backup_scheduler_tick: "backups.scheduler.tick",
  verify_event_history_integrity: "event_history.integrity.read",
  rotate_event_history: "event_history.rotation.run",
  read_event_history_retention: "event_history.retention.read",
  update_event_history_retention: "event_history.retention.write",
  prune_event_history: "event_history.retention.prune",
  list_event_history_exports: "event_history.exports.read",
  read_event_history_export: "event_history.exports.read",
  create_event_history_export: "event_history.exports.create",
  download_event_history_export: "event_history.exports.download",
  prune_event_history_exports: "event_history.exports.prune",
});

export class AdministrativeOperationValidationError extends Error {
  public override readonly name = "AdministrativeOperationValidationError";
  public constructor(public readonly code: "invalid_operation") {
    super(`Invalid administrative operation: ${code}`);
    Object.freeze(this);
  }
}

export function createAdministrativeOperation(
  input: unknown,
): AdministrativeOperation {
  if (
    typeof input !== "string" ||
    !(ADMINISTRATIVE_OPERATIONS as readonly string[]).includes(input)
  )
    throw new AdministrativeOperationValidationError("invalid_operation");
  return input as AdministrativeOperation;
}

export function permissionForAdministrativeOperation(
  operation: AdministrativeOperation,
): AdministrativePermission {
  return OPERATION_PERMISSIONS[operation];
}

export function roleHasAdministrativePermission(
  role: AdministrativeRole,
  permission: AdministrativePermission,
): boolean {
  return ADMINISTRATIVE_ROLE_PERMISSIONS[role].includes(permission);
}
