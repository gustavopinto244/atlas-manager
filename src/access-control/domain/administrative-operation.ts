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
  ] as AdministrativePermission[]),
  scheduler_operator: Object.freeze([
    "power.scheduler.tick",
  ] as AdministrativePermission[]),
  auditor: Object.freeze(["event_history.read"] as AdministrativePermission[]),
  administrator: Object.freeze([
    "power.wake.read",
    "power.wake.schedule",
    "power.wake.cancel",
    "power.shutdown.request",
    "power.shutdown.prepare",
    "power.shutdown.execute",
    "power.scheduler.tick",
    "event_history.read",
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
