import {
  ADMINISTRATIVE_OPERATIONS,
  permissionForAdministrativeOperation,
  type AdministrativeOperation,
} from "../access-control/domain/administrative-operation.js";
import type { AdministrativePermission } from "../access-control/domain/administrative-permission.js";

export type AdministrativeRouteSecurityDescriptor = Readonly<{
  routeId: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  pathTemplate: string;
  activationFlag: string;
  authenticationPolicy: "required";
  operation: AdministrativeOperation;
  permission: AdministrativePermission;
  requestPolicy: Readonly<{
    body: "none" | "json";
    maxBodyBytes: number;
    maxRequestTargetBytes: number;
    contentTypes: readonly string[];
    contentEncodings: readonly string[];
    duplicateKeys: "reject";
    unknownFields: "reject";
  }>;
  confirmationPolicy: "none" | `exact:${string}`;
  admissionPolicy: "shared_administrative";
  gatePolicy:
    | "administrative_global"
    | "service_mutation"
    | "backup_operation"
    | "event_history_maintenance"
    | "power_operation"
    | "none";
  auditPolicy: "authorization_only" | "authorization_started_terminal";
  replayPolicy:
    | "read_only"
    | "domain_idempotent"
    | "claim_protected"
    | "conflict_protected"
    | "state_recheck_required";
  responsePolicy: "json" | "html" | "asset" | "download";
  dashboardExposure: "shell" | "asset" | "api";
}>;

const ADMINISTRATIVE_ACTIVATION_FLAGS = new Set([
  "ADMINISTRATIVE_DASHBOARD_ENABLED",
  "ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED",
  "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
  "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED",
  "ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED",
  "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
  "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED",
  "ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED",
  "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
  "ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED",
]);

const JSON_BODY = Object.freeze({
  body: "json" as const,
  maxBodyBytes: 8_192,
  maxRequestTargetBytes: 4_096,
  contentTypes: Object.freeze([
    "application/json",
    "application/json; charset=utf-8",
  ]),
  contentEncodings: Object.freeze(["identity"]),
  duplicateKeys: "reject" as const,
  unknownFields: "reject" as const,
});
const NO_BODY = Object.freeze({
  ...JSON_BODY,
  body: "none" as const,
  maxBodyBytes: 0,
});

function route(
  input: Omit<
    AdministrativeRouteSecurityDescriptor,
    "permission" | "authenticationPolicy" | "admissionPolicy" | "requestPolicy"
  > & {
    requestPolicy?: AdministrativeRouteSecurityDescriptor["requestPolicy"];
  },
): AdministrativeRouteSecurityDescriptor {
  const descriptor = Object.freeze({
    ...input,
    authenticationPolicy: "required" as const,
    permission: permissionForAdministrativeOperation(input.operation),
    requestPolicy: input.requestPolicy ?? NO_BODY,
    admissionPolicy: "shared_administrative" as const,
  });
  return descriptor;
}

const read = (
  routeId: string,
  method: "GET",
  pathTemplate: string,
  activationFlag: string,
  operation: AdministrativeOperation,
  responsePolicy: "json" | "html" | "asset" | "download" = "json",
) =>
  route({
    routeId,
    method,
    pathTemplate,
    activationFlag,
    operation,
    confirmationPolicy: "none",
    gatePolicy: "none",
    auditPolicy: "authorization_only",
    replayPolicy: "read_only",
    responsePolicy,
    dashboardExposure:
      responsePolicy === "html"
        ? "shell"
        : responsePolicy === "asset"
          ? "asset"
          : "api",
  });
const mutation = (
  routeId: string,
  method: "POST" | "PUT" | "DELETE",
  pathTemplate: string,
  activationFlag: string,
  operation: AdministrativeOperation,
  confirmation: string,
  gatePolicy: AdministrativeRouteSecurityDescriptor["gatePolicy"],
  replayPolicy: AdministrativeRouteSecurityDescriptor["replayPolicy"] = "state_recheck_required",
) =>
  route({
    routeId,
    method,
    pathTemplate,
    activationFlag,
    operation,
    confirmationPolicy: `exact:${confirmation}`,
    gatePolicy,
    auditPolicy: "authorization_started_terminal",
    replayPolicy,
    responsePolicy: "json",
    dashboardExposure: "api",
    requestPolicy: JSON_BODY,
  });
const mutationWithoutConfirmation = (
  routeId: string,
  method: "PUT" | "DELETE",
  pathTemplate: string,
  activationFlag: string,
  operation: AdministrativeOperation,
  gatePolicy: AdministrativeRouteSecurityDescriptor["gatePolicy"],
) =>
  route({
    routeId,
    method,
    pathTemplate,
    activationFlag,
    operation,
    confirmationPolicy: "none",
    gatePolicy,
    auditPolicy: "authorization_started_terminal",
    replayPolicy: "state_recheck_required",
    responsePolicy: "json",
    dashboardExposure: "api",
    requestPolicy: JSON_BODY,
  });

export const ADMINISTRATIVE_ROUTE_SECURITY_CATALOG: readonly AdministrativeRouteSecurityDescriptor[] =
  Object.freeze([
    read(
      "dashboard.read",
      "GET",
      "/admin",
      "ADMINISTRATIVE_DASHBOARD_ENABLED",
      "read_administrative_dashboard",
      "html",
    ),
    read(
      "dashboard.read.root",
      "GET",
      "/admin/",
      "ADMINISTRATIVE_DASHBOARD_ENABLED",
      "read_administrative_dashboard",
      "html",
    ),
    read(
      "dashboard.asset.read",
      "GET",
      "/admin/assets/:asset",
      "ADMINISTRATIVE_DASHBOARD_ENABLED",
      "read_administrative_dashboard",
      "asset",
    ),
    read(
      "event_history.read",
      "GET",
      "/admin/event-history",
      "ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED",
      "read_administrative_event_history",
    ),
    read(
      "power.wake.read",
      "GET",
      "/admin/power/wake-alarm",
      "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED",
      "read_wake_alarm",
    ),
    mutationWithoutConfirmation(
      "power.wake.update",
      "PUT",
      "/admin/power/wake-alarm",
      "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED",
      "schedule_wake_alarm",
      "power_operation",
    ),
    mutationWithoutConfirmation(
      "power.wake.delete",
      "DELETE",
      "/admin/power/wake-alarm",
      "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED",
      "cancel_wake_alarm",
      "power_operation",
    ),
    mutation(
      "power.shutdown.prepare",
      "POST",
      "/admin/power/shutdown/preparations",
      "ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED",
      "prepare_machine_shutdown_occurrence",
      "confirm_shutdown_preparation",
      "power_operation",
    ),
    mutation(
      "power.shutdown.execute",
      "POST",
      "/admin/power/shutdown/executions",
      "ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED",
      "execute_machine_shutdown_occurrence",
      "confirm_shutdown_execution",
      "power_operation",
    ),
    read(
      "services.list",
      "GET",
      "/admin/services",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "read_registered_services",
    ),
    read(
      "services.read",
      "GET",
      "/admin/services/:serviceId",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "read_registered_service",
    ),
    mutation(
      "services.start",
      "POST",
      "/admin/services/:serviceId/actions/start",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "start_registered_service",
      "confirm_registered_service_start",
      "service_mutation",
    ),
    mutation(
      "services.stop",
      "POST",
      "/admin/services/:serviceId/actions/stop",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "stop_registered_service",
      "confirm_registered_service_stop",
      "service_mutation",
    ),
    mutation(
      "services.restart",
      "POST",
      "/admin/services/:serviceId/actions/restart",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "restart_registered_service",
      "confirm_registered_service_restart",
      "service_mutation",
    ),
    read(
      "services.availability.read",
      "GET",
      "/admin/services/:serviceId/availability",
      "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED",
      "read_registered_service_availability",
    ),
    mutation(
      "services.availability.update",
      "PUT",
      "/admin/services/:serviceId/availability",
      "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED",
      "update_registered_service_availability",
      "confirm_registered_service_availability_update",
      "service_mutation",
    ),
    mutation(
      "services.availability.delete",
      "DELETE",
      "/admin/services/:serviceId/availability",
      "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED",
      "remove_registered_service_availability",
      "confirm_registered_service_availability_removal",
      "service_mutation",
    ),
    read(
      "operations.read",
      "GET",
      "/admin/overview",
      "ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED",
      "read_operations_overview",
    ),
    read(
      "backups.targets.read",
      "GET",
      "/admin/backups/targets",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "read_registered_backup_targets",
    ),
    read(
      "backups.target.read",
      "GET",
      "/admin/backups/targets/:targetId",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "read_registered_backup_target",
    ),
    read(
      "backups.runs.read",
      "GET",
      "/admin/backups/runs",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "read_backup_runs",
    ),
    read(
      "backups.run.read",
      "GET",
      "/admin/backups/runs/:runId",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "read_backup_run",
    ),
    mutation(
      "backups.run",
      "POST",
      "/admin/backups/targets/:targetId/runs",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "run_registered_backup",
      "confirm_registered_backup_run",
      "backup_operation",
    ),
    read(
      "backups.schedule.read",
      "GET",
      "/admin/backups/targets/:targetId/schedule",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "read_backup_schedule",
    ),
    mutation(
      "backups.schedule.update",
      "PUT",
      "/admin/backups/targets/:targetId/schedule",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "update_backup_schedule",
      "confirm_registered_backup_schedule_update",
      "backup_operation",
    ),
    mutation(
      "backups.schedule.delete",
      "DELETE",
      "/admin/backups/targets/:targetId/schedule",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "remove_backup_schedule",
      "confirm_registered_backup_schedule_removal",
      "backup_operation",
    ),
    read(
      "backups.retention.read",
      "GET",
      "/admin/backups/targets/:targetId/retention",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "read_backup_retention",
    ),
    mutation(
      "backups.retention.update",
      "PUT",
      "/admin/backups/targets/:targetId/retention",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "update_backup_retention",
      "confirm_registered_backup_retention_update",
      "backup_operation",
    ),
    mutation(
      "backups.retention.prune",
      "POST",
      "/admin/backups/targets/:targetId/retention/prunes",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "run_backup_retention_prune",
      "confirm_registered_backup_retention_prune",
      "backup_operation",
    ),
    mutation(
      "backups.scheduler.tick",
      "POST",
      "/admin/backups/scheduler/ticks",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "run_backup_scheduler_tick",
      "confirm_backup_scheduler_tick",
      "backup_operation",
      "claim_protected",
    ),
    read(
      "event_history.integrity.read",
      "GET",
      "/admin/event-history/integrity",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "verify_event_history_integrity",
    ),
    mutation(
      "event_history.rotation.run",
      "POST",
      "/admin/event-history/rotations",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "rotate_event_history",
      "confirm_administrative_event_history_rotation",
      "event_history_maintenance",
      "conflict_protected",
    ),
    read(
      "event_history.retention.read",
      "GET",
      "/admin/event-history/retention",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "read_event_history_retention",
    ),
    mutation(
      "event_history.retention.update",
      "PUT",
      "/admin/event-history/retention",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "update_event_history_retention",
      "confirm_administrative_event_history_retention_update",
      "event_history_maintenance",
    ),
    mutation(
      "event_history.retention.prune",
      "POST",
      "/admin/event-history/retention/prunes",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "prune_event_history",
      "confirm_administrative_event_history_retention_prune",
      "event_history_maintenance",
      "conflict_protected",
    ),
    read(
      "event_history.exports.read",
      "GET",
      "/admin/event-history/exports",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "list_event_history_exports",
    ),
    mutation(
      "event_history.exports.create",
      "POST",
      "/admin/event-history/exports",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "create_event_history_export",
      "confirm_administrative_event_history_export",
      "event_history_maintenance",
      "state_recheck_required",
    ),
    read(
      "event_history.export.read",
      "GET",
      "/admin/event-history/exports/:exportId",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "read_event_history_export",
    ),
    read(
      "event_history.export.download",
      "GET",
      "/admin/event-history/exports/:exportId/content",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "download_event_history_export",
      "download",
    ),
    mutation(
      "event_history.exports.prune",
      "POST",
      "/admin/event-history/exports/retention/prunes",
      "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED",
      "prune_event_history_exports",
      "confirm_administrative_event_history_export_prune",
      "event_history_maintenance",
      "conflict_protected",
    ),
    read(
      "security.status.read",
      "GET",
      "/admin/security/status",
      "ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED",
      "read_administrative_security_posture",
    ),
  ] as const);

export function validateAdministrativeRouteSecurityCatalog(): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const descriptor of ADMINISTRATIVE_ROUTE_SECURITY_CATALOG) {
    if (
      ids.has(descriptor.routeId) ||
      paths.has(`${descriptor.method} ${descriptor.pathTemplate}`)
    )
      throw new Error("administrative_route_policy_invalid");
    ids.add(descriptor.routeId);
    paths.add(`${descriptor.method} ${descriptor.pathTemplate}`);
    if (!ADMINISTRATIVE_ACTIVATION_FLAGS.has(descriptor.activationFlag))
      throw new Error("administrative_route_policy_invalid");
    if (descriptor.authenticationPolicy !== "required")
      throw new Error("administrative_route_policy_invalid");
    if (
      !(ADMINISTRATIVE_OPERATIONS as readonly string[]).includes(
        descriptor.operation,
      )
    )
      throw new Error("administrative_route_policy_invalid");
    if (descriptor.method === "GET" && descriptor.confirmationPolicy !== "none")
      throw new Error("administrative_route_policy_invalid");
    if (
      descriptor.method !== "GET" &&
      descriptor.auditPolicy !== "authorization_started_terminal"
    )
      throw new Error("administrative_route_policy_invalid");
  }
}

validateAdministrativeRouteSecurityCatalog();
