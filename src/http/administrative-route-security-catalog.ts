import {
  ADMINISTRATIVE_OPERATIONS,
  permissionForAdministrativeOperation,
  type AdministrativeOperation,
} from "../access-control/domain/administrative-operation.js";
import type { AdministrativePermission } from "../access-control/domain/administrative-permission.js";
import type { Express, RequestHandler } from "express";

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
  // Not an environment variable. Unlike every other entry here, this one is a
  // derived runtime activation: the service schedule routes register when
  // service availability HTTP is enabled *and* SERVICE_AVAILABILITY_POLICY_FILE
  // gives them a policy store. The _HTTP_ENABLED suffix it carried before
  // implied an operator-settable variable that has never existed, which sent
  // readers looking for it in .env.example.
  "ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY",
  // Not an environment variable, for the same reason as
  // ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY above: the machine schedule
  // routes register when wake-alarm HTTP is enabled *and*
  // MACHINE_OPERATING_POLICY_FILE gives them a persisted policy store
  // (ADR-033).
  "ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY",
  "ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED",
  "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
  "ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED",
  "ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_HTTP_ENABLED",
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
const WAKE_ALARM_JSON_BODY = Object.freeze({ ...JSON_BODY, maxBodyBytes: 512 });
const SHUTDOWN_JSON_BODY = Object.freeze({
  ...JSON_BODY,
  maxBodyBytes: 1_024,
});
// Matches ADMINISTRATIVE_SERVICE_MAX_BODY_BYTES in administrative-services-route.ts —
// these bodies only ever carry a fixed confirmation string.
const SERVICE_ACTION_JSON_BODY = Object.freeze({
  ...JSON_BODY,
  maxBodyBytes: 512,
});
// Matches MAX_BODY_BYTES in administrative-service-availability-route.ts,
// administrative-service-schedule-route.ts and administrative-machine-schedule-route.ts.
const SCHEDULE_JSON_BODY = Object.freeze({
  ...JSON_BODY,
  maxBodyBytes: 4_096,
});
// Matches MAX_BODY_BYTES in administrative-backups-route.ts.
const BACKUP_JSON_BODY = Object.freeze({
  ...JSON_BODY,
  maxBodyBytes: 4_096,
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
  requestPolicy: AdministrativeRouteSecurityDescriptor["requestPolicy"] = JSON_BODY,
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
    requestPolicy,
  });
const mutationWithoutConfirmation = (
  routeId: string,
  method: "PUT" | "DELETE",
  pathTemplate: string,
  activationFlag: string,
  operation: AdministrativeOperation,
  gatePolicy: AdministrativeRouteSecurityDescriptor["gatePolicy"],
  requestPolicy: AdministrativeRouteSecurityDescriptor["requestPolicy"] = JSON_BODY,
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
    requestPolicy,
  });

export const ADMINISTRATIVE_ROUTE_SECURITY_CATALOG: readonly AdministrativeRouteSecurityDescriptor[] =
  Object.freeze([
    read(
      "dashboard.read",
      "GET",
      "/",
      "ADMINISTRATIVE_DASHBOARD_ENABLED",
      "read_administrative_dashboard",
      "html",
    ),
    read(
      "dashboard.asset.read",
      "GET",
      "/assets/:asset",
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
      WAKE_ALARM_JSON_BODY,
    ),
    mutationWithoutConfirmation(
      "power.wake.delete",
      "DELETE",
      "/admin/power/wake-alarm",
      "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED",
      "cancel_wake_alarm",
      "power_operation",
      NO_BODY,
    ),
    mutation(
      "power.shutdown.prepare",
      "POST",
      "/admin/power/shutdown/preparations",
      "ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED",
      "prepare_machine_shutdown_occurrence",
      "confirm_shutdown_preparation",
      "power_operation",
      "state_recheck_required",
      SHUTDOWN_JSON_BODY,
    ),
    mutation(
      "power.shutdown.execute",
      "POST",
      "/admin/power/shutdown/executions",
      "ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED",
      "execute_machine_shutdown_occurrence",
      "confirm_shutdown_execution",
      "power_operation",
      "state_recheck_required",
      SHUTDOWN_JSON_BODY,
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
    read(
      "services.logs.read",
      "GET",
      "/admin/services/:serviceId/logs",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "read_registered_service_logs",
    ),
    read(
      "services.resources.read",
      "GET",
      "/admin/services/:serviceId/resources",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "read_registered_service_resources",
    ),
    mutation(
      "services.start",
      "POST",
      "/admin/services/:serviceId/actions/start",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "start_registered_service",
      "confirm_registered_service_start",
      "service_mutation",
      "state_recheck_required",
      SERVICE_ACTION_JSON_BODY,
    ),
    mutation(
      "services.stop",
      "POST",
      "/admin/services/:serviceId/actions/stop",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "stop_registered_service",
      "confirm_registered_service_stop",
      "service_mutation",
      "state_recheck_required",
      SERVICE_ACTION_JSON_BODY,
    ),
    mutation(
      "services.restart",
      "POST",
      "/admin/services/:serviceId/actions/restart",
      "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED",
      "restart_registered_service",
      "confirm_registered_service_restart",
      "service_mutation",
      "state_recheck_required",
      SERVICE_ACTION_JSON_BODY,
    ),
    read(
      "services.availability.read",
      "GET",
      "/admin/services/:serviceId/availability",
      "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED",
      "read_registered_service_availability",
    ),
    read(
      "services.schedule.read",
      "GET",
      "/admin/services/:serviceId/schedule",
      "ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY",
      "read_registered_service_schedule",
    ),
    read(
      "services.availability.preview",
      "GET",
      "/admin/services/:serviceId/availability/preview",
      "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED",
      "read_registered_service_availability_preview",
    ),
    read(
      "services.schedule.preview",
      "GET",
      "/admin/services/:serviceId/schedule/preview",
      "ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY",
      "read_registered_service_schedule_preview",
    ),
    mutation(
      "services.availability.update",
      "PUT",
      "/admin/services/:serviceId/availability",
      "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED",
      "update_registered_service_availability",
      "confirm_registered_service_availability_update",
      "service_mutation",
      "state_recheck_required",
      SCHEDULE_JSON_BODY,
    ),
    mutation(
      "services.availability.delete",
      "DELETE",
      "/admin/services/:serviceId/availability",
      "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED",
      "remove_registered_service_availability",
      "confirm_registered_service_availability_removal",
      "service_mutation",
      "state_recheck_required",
      SCHEDULE_JSON_BODY,
    ),
    mutation(
      "services.schedule.update",
      "PUT",
      "/admin/services/:serviceId/schedule",
      "ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY",
      "update_registered_service_schedule",
      "confirm_registered_service_schedule_update",
      "service_mutation",
      "state_recheck_required",
      SCHEDULE_JSON_BODY,
    ),
    mutation(
      "services.schedule.delete",
      "DELETE",
      "/admin/services/:serviceId/schedule",
      "ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY",
      "remove_registered_service_schedule",
      "confirm_registered_service_schedule_removal",
      "service_mutation",
      "state_recheck_required",
      SCHEDULE_JSON_BODY,
    ),
    read(
      "machine.schedule.read",
      "GET",
      "/admin/machine/schedule",
      "ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY",
      "read_machine_operating_policy",
    ),
    read(
      "machine.schedule.preview",
      "GET",
      "/admin/machine/schedule/preview",
      "ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY",
      "read_machine_operating_policy_preview",
    ),
    mutation(
      "machine.schedule.update",
      "PUT",
      "/admin/machine/schedule",
      "ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY",
      "update_machine_operating_policy",
      "confirm_machine_operating_policy_update",
      "service_mutation",
      "state_recheck_required",
      SCHEDULE_JSON_BODY,
    ),
    mutation(
      "machine.schedule.delete",
      "DELETE",
      "/admin/machine/schedule",
      "ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY",
      "remove_machine_operating_policy",
      "confirm_machine_operating_policy_removal",
      "service_mutation",
      "state_recheck_required",
      SCHEDULE_JSON_BODY,
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
      "state_recheck_required",
      BACKUP_JSON_BODY,
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
      "state_recheck_required",
      BACKUP_JSON_BODY,
    ),
    mutation(
      "backups.schedule.delete",
      "DELETE",
      "/admin/backups/targets/:targetId/schedule",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "remove_backup_schedule",
      "confirm_registered_backup_schedule_removal",
      "backup_operation",
      "state_recheck_required",
      BACKUP_JSON_BODY,
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
      "state_recheck_required",
      BACKUP_JSON_BODY,
    ),
    mutation(
      "backups.retention.prune",
      "POST",
      "/admin/backups/targets/:targetId/retention/prunes",
      "ADMINISTRATIVE_BACKUP_HTTP_ENABLED",
      "run_backup_retention_prune",
      "confirm_registered_backup_retention_prune",
      "backup_operation",
      "state_recheck_required",
      BACKUP_JSON_BODY,
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
      BACKUP_JSON_BODY,
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
    read(
      "infrastructure.diagnostics.read",
      "GET",
      "/admin/infrastructure/diagnostics",
      "ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_HTTP_ENABLED",
      "read_infrastructure_diagnostics",
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
    if (
      descriptor.permission !==
      permissionForAdministrativeOperation(descriptor.operation)
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

export function findAdministrativeRouteSecurityDescriptor(
  routeId: string,
): AdministrativeRouteSecurityDescriptor {
  const descriptor = ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.find(
    (value) => value.routeId === routeId,
  );
  if (descriptor === undefined)
    throw new Error("administrative_route_policy_invalid");
  return descriptor;
}

const routeRegistries = new WeakMap<Express, Set<string>>();
const routeDescriptors = new WeakMap<object, readonly string[]>();

/**
 * The only production boundary allowed to register an /admin route.
 * Multiple catalog descriptors may share one Express path when the handler
 * deliberately dispatches by method (for example GET/PUT/DELETE).
 */
export function registerAdministrativeRoute(
  app: Express,
  routeIds: readonly string[],
  handler: RequestHandler,
): void {
  if (routeIds.length === 0)
    throw new Error("administrative_route_policy_invalid");
  const descriptors = routeIds.map(findAdministrativeRouteSecurityDescriptor);
  const path = descriptors[0]!.pathTemplate;
  if (descriptors.some((descriptor) => descriptor.pathTemplate !== path))
    throw new Error("administrative_route_policy_invalid");
  const registered = routeRegistries.get(app) ?? new Set<string>();
  for (const descriptor of descriptors) {
    if (registered.has(descriptor.routeId))
      throw new Error("administrative_route_policy_invalid");
    registered.add(descriptor.routeId);
  }
  routeRegistries.set(app, registered);
  app.all(path, handler);
  const runtime = app as Express & {
    router?: { stack?: readonly unknown[] };
  };
  const layer = runtime.router?.stack?.at(-1);
  const route =
    typeof layer === "object" && layer !== null
      ? (layer as { route?: unknown }).route
      : undefined;
  if (typeof route !== "object" || route === null)
    throw new Error("administrative_route_policy_invalid");
  routeDescriptors.set(
    route,
    Object.freeze(descriptors.map((descriptor) => descriptor.routeId)),
  );
}

export function expectedAdministrativeRouteIds(
  activationFlags: readonly string[],
): readonly string[] {
  const enabled = new Set(activationFlags);
  return Object.freeze(
    ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.filter((descriptor) =>
      enabled.has(descriptor.activationFlag),
    ).map((descriptor) => descriptor.routeId),
  );
}

export function reconcileAdministrativeRouteRegistrations(
  app: Express,
  expectedRouteIds: readonly string[],
): void {
  const registered = routeRegistries.get(app) ?? new Set<string>();
  const expected = new Set(expectedRouteIds);
  const runtime = app as Express & {
    router?: { stack?: readonly unknown[] };
  };
  const stack = runtime.router?.stack;
  if (!Array.isArray(stack))
    throw new Error("administrative_route_policy_invalid");
  for (const layer of stack) {
    if (typeof layer !== "object" || layer === null) continue;
    const route = (layer as { route?: unknown }).route;
    if (typeof route !== "object" || route === null) continue;
    const path = (route as { path?: unknown }).path;
    if (
      typeof path !== "string" ||
      (!path.startsWith("/admin") &&
        path !== "/" &&
        !path.startsWith("/assets/"))
    )
      continue;
    if (routeDescriptors.get(route) === undefined)
      throw new Error("administrative_route_policy_invalid");
  }
  if (
    registered.size !== expected.size ||
    [...registered].some((routeId) => !expected.has(routeId))
  )
    throw new Error("administrative_route_policy_invalid");
}

validateAdministrativeRouteSecurityCatalog();
