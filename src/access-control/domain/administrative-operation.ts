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
    "operations.read",
    "dashboard.read",
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
