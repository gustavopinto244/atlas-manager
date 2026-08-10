/**
 * CLI-side binding to the canonical administrative route security catalog
 * (`src/http/administrative-route-security-catalog.ts`).
 *
 * The CLI cannot import that catalog at runtime: the operator package ships
 * only `dist/cli`, so a server import would either break the package or drag
 * the whole application composition into it. ADR-031 therefore declares this
 * small table as the CLI's copy of the contract and pins it to the catalog
 * with a contract test — `tests/cli/administrative-contract.test.ts` fails if
 * a route id, method, path template or confirmation ever drifts apart.
 *
 * Nothing here may be hand-edited to "fix" a failing contract test. The
 * catalog is authoritative; this table follows it.
 */

export type AtlasServiceOperation = "start" | "stop" | "restart";

export const ATLAS_SERVICE_OPERATIONS: readonly AtlasServiceOperation[] =
  Object.freeze(["start", "stop", "restart"]);

export type AtlasAdministrativeMutationDescriptor = Readonly<{
  /** Route id in the administrative route security catalog. */
  routeId: string;
  method: "POST" | "PUT" | "DELETE";
  /** Path template exactly as the catalog declares it. */
  pathTemplate: string;
  /**
   * The exact confirmation the route's `confirmationPolicy` requires. Derived
   * from the catalog, never invented by a command handler.
   */
  confirmation: string;
}>;

const SERVICE_ACTION_MUTATIONS: Readonly<
  Record<AtlasServiceOperation, AtlasAdministrativeMutationDescriptor>
> = Object.freeze({
  start: Object.freeze({
    routeId: "services.start",
    method: "POST",
    pathTemplate: "/admin/services/:serviceId/actions/start",
    confirmation: "confirm_registered_service_start",
  }),
  stop: Object.freeze({
    routeId: "services.stop",
    method: "POST",
    pathTemplate: "/admin/services/:serviceId/actions/stop",
    confirmation: "confirm_registered_service_stop",
  }),
  restart: Object.freeze({
    routeId: "services.restart",
    method: "POST",
    pathTemplate: "/admin/services/:serviceId/actions/restart",
    confirmation: "confirm_registered_service_restart",
  }),
});

export const ATLAS_SERVICE_ACTION_MUTATIONS = SERVICE_ACTION_MUTATIONS;

/** Path template of the authoritative single-service read used after a mutation. */
export const ATLAS_SERVICE_READ_PATH_TEMPLATE = "/admin/services/:serviceId";

export function serviceActionMutation(
  operation: AtlasServiceOperation,
): AtlasAdministrativeMutationDescriptor {
  return SERVICE_ACTION_MUTATIONS[operation];
}

export function serviceActionPath(
  operation: AtlasServiceOperation,
  serviceId: string,
): string {
  return SERVICE_ACTION_MUTATIONS[operation].pathTemplate.replace(
    ":serviceId",
    encodeURIComponent(serviceId),
  );
}

export function serviceReadPath(serviceId: string): string {
  return ATLAS_SERVICE_READ_PATH_TEMPLATE.replace(
    ":serviceId",
    encodeURIComponent(serviceId),
  );
}

// ---------------------------------------------------------------------------
// Registered-service schedule mutations
// ---------------------------------------------------------------------------

export type AtlasServiceScheduleOperation = "update" | "delete";

export const ATLAS_SERVICE_SCHEDULE_OPERATIONS: readonly AtlasServiceScheduleOperation[] =
  Object.freeze(["update", "delete"]);

const SERVICE_SCHEDULE_MUTATIONS: Readonly<
  Record<AtlasServiceScheduleOperation, AtlasAdministrativeMutationDescriptor>
> = Object.freeze({
  update: Object.freeze({
    routeId: "services.schedule.update",
    method: "PUT",
    pathTemplate: "/admin/services/:serviceId/schedule",
    confirmation: "confirm_registered_service_schedule_update",
  }),
  delete: Object.freeze({
    routeId: "services.schedule.delete",
    method: "DELETE",
    pathTemplate: "/admin/services/:serviceId/schedule",
    confirmation: "confirm_registered_service_schedule_removal",
  }),
});

export const ATLAS_SERVICE_SCHEDULE_MUTATIONS = SERVICE_SCHEDULE_MUTATIONS;

/** Path template of the authoritative schedule read used after a mutation. */
export const ATLAS_SERVICE_SCHEDULE_READ_PATH_TEMPLATE =
  "/admin/services/:serviceId/schedule";

/**
 * The alias subcommands (`always`, `manual`, `disable`) each write one explicit
 * *stored* policy override. They are re-declared here rather than imported from
 * `src/service-scheduling/domain`: the operator package ships only `dist/cli`,
 * and the CLI may not import server domain code at all.
 *
 * Note that the CLI subcommand word and the domain mode are not always the same
 * string — `disable` (a verb the operator types) writes mode `disabled` (the
 * adjective the domain stores) — so the mapping is explicit, never assumed.
 *
 * None of these is the same thing as `services schedule remove`, which deletes
 * the stored override entirely and lets the service fall back to its static
 * environment-configured default policy.
 */
export const ATLAS_SERVICE_SCHEDULE_ALIAS_MODES: Readonly<
  Record<"always" | "manual" | "disable", string>
> = Object.freeze({
  always: "always",
  manual: "manual",
  disable: "disabled",
});

export function serviceScheduleMutation(
  operation: AtlasServiceScheduleOperation,
): AtlasAdministrativeMutationDescriptor {
  return SERVICE_SCHEDULE_MUTATIONS[operation];
}

export function serviceSchedulePath(serviceId: string): string {
  return ATLAS_SERVICE_SCHEDULE_READ_PATH_TEMPLATE.replace(
    ":serviceId",
    encodeURIComponent(serviceId),
  );
}

// ---------------------------------------------------------------------------
// Registered-backup operations
// ---------------------------------------------------------------------------

export type AtlasBackupOperation = "run";

export const ATLAS_BACKUP_OPERATIONS: readonly AtlasBackupOperation[] =
  Object.freeze(["run"]);

const BACKUP_ACTION_MUTATIONS: Readonly<
  Record<AtlasBackupOperation, AtlasAdministrativeMutationDescriptor>
> = Object.freeze({
  run: Object.freeze({
    routeId: "backups.run",
    method: "POST",
    pathTemplate: "/admin/backups/targets/:targetId/runs",
    confirmation: "confirm_registered_backup_run",
  }),
});

export const ATLAS_BACKUP_ACTION_MUTATIONS = BACKUP_ACTION_MUTATIONS;

export const ATLAS_BACKUP_TARGET_READ_PATH_TEMPLATE =
  "/admin/backups/targets/:targetId";
export const ATLAS_BACKUP_RUN_READ_PATH_TEMPLATE = "/admin/backups/runs/:runId";

export function backupActionMutation(
  operation: AtlasBackupOperation,
): AtlasAdministrativeMutationDescriptor {
  return BACKUP_ACTION_MUTATIONS[operation];
}

export function backupActionPath(
  operation: AtlasBackupOperation,
  targetId: string,
): string {
  return BACKUP_ACTION_MUTATIONS[operation].pathTemplate.replace(
    ":targetId",
    encodeURIComponent(targetId),
  );
}

export function backupTargetReadPath(targetId: string): string {
  return ATLAS_BACKUP_TARGET_READ_PATH_TEMPLATE.replace(
    ":targetId",
    encodeURIComponent(targetId),
  );
}

export function backupRunReadPath(runId: string): string {
  return ATLAS_BACKUP_RUN_READ_PATH_TEMPLATE.replace(
    ":runId",
    encodeURIComponent(runId),
  );
}

export type AtlasBackupScheduleOperation = "update" | "delete";

export const ATLAS_BACKUP_SCHEDULE_OPERATIONS: readonly AtlasBackupScheduleOperation[] =
  Object.freeze(["update", "delete"]);

const BACKUP_SCHEDULE_MUTATIONS: Readonly<
  Record<AtlasBackupScheduleOperation, AtlasAdministrativeMutationDescriptor>
> = Object.freeze({
  update: Object.freeze({
    routeId: "backups.schedule.update",
    method: "PUT",
    pathTemplate: "/admin/backups/targets/:targetId/schedule",
    confirmation: "confirm_registered_backup_schedule_update",
  }),
  delete: Object.freeze({
    routeId: "backups.schedule.delete",
    method: "DELETE",
    pathTemplate: "/admin/backups/targets/:targetId/schedule",
    confirmation: "confirm_registered_backup_schedule_removal",
  }),
});

export const ATLAS_BACKUP_SCHEDULE_MUTATIONS = BACKUP_SCHEDULE_MUTATIONS;

export type AtlasBackupRetentionOperation = "update" | "prune";

export const ATLAS_BACKUP_RETENTION_OPERATIONS: readonly AtlasBackupRetentionOperation[] =
  Object.freeze(["update", "prune"]);

const BACKUP_RETENTION_MUTATIONS: Readonly<
  Record<AtlasBackupRetentionOperation, AtlasAdministrativeMutationDescriptor>
> = Object.freeze({
  update: Object.freeze({
    routeId: "backups.retention.update",
    method: "PUT",
    pathTemplate: "/admin/backups/targets/:targetId/retention",
    confirmation: "confirm_registered_backup_retention_update",
  }),
  prune: Object.freeze({
    routeId: "backups.retention.prune",
    method: "POST",
    pathTemplate: "/admin/backups/targets/:targetId/retention/prunes",
    confirmation: "confirm_registered_backup_retention_prune",
  }),
});

export const ATLAS_BACKUP_RETENTION_MUTATIONS = BACKUP_RETENTION_MUTATIONS;

/**
 * `backups.scheduler.tick` is deliberately absent from this table and has no
 * CLI command. Its `claim_protected` replay policy and reentrancy-guarded
 * compare-and-set cursor mark it as internal, cron-triggered maintenance whose
 * correctness depends on not being invoked ad hoc; exposing it as an
 * interactive operator command would invite exactly that.
 */

export const ATLAS_BACKUP_SCHEDULE_READ_PATH_TEMPLATE =
  "/admin/backups/targets/:targetId/schedule";
export const ATLAS_BACKUP_RETENTION_READ_PATH_TEMPLATE =
  "/admin/backups/targets/:targetId/retention";

export function backupScheduleMutation(
  operation: AtlasBackupScheduleOperation,
): AtlasAdministrativeMutationDescriptor {
  return BACKUP_SCHEDULE_MUTATIONS[operation];
}

export function backupRetentionMutation(
  operation: AtlasBackupRetentionOperation,
): AtlasAdministrativeMutationDescriptor {
  return BACKUP_RETENTION_MUTATIONS[operation];
}

export function backupSchedulePath(targetId: string): string {
  return ATLAS_BACKUP_SCHEDULE_READ_PATH_TEMPLATE.replace(
    ":targetId",
    encodeURIComponent(targetId),
  );
}

export function backupRetentionPath(targetId: string): string {
  return ATLAS_BACKUP_RETENTION_READ_PATH_TEMPLATE.replace(
    ":targetId",
    encodeURIComponent(targetId),
  );
}

export function backupRetentionPrunePath(targetId: string): string {
  return BACKUP_RETENTION_MUTATIONS.prune.pathTemplate.replace(
    ":targetId",
    encodeURIComponent(targetId),
  );
}

/**
 * A backup is addressed by *registered target id* only. There is deliberately
 * no source or destination path anywhere in this vocabulary: accepting one
 * would let an operator back up or write to a location the application does
 * not know about, outside its authorization, limits and audit model.
 */
const BACKUP_TARGET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isAtlasBackupTargetId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    BACKUP_TARGET_ID_PATTERN.test(value)
  );
}

/** Mirrors the server's `isRunId`: a canonical UUID with a valid variant. */
const BACKUP_RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function isAtlasBackupRunId(value: string): boolean {
  return BACKUP_RUN_ID_PATTERN.test(value);
}

/**
 * Registered-service identifier grammar, mirroring the server's `isServiceId`.
 * Applied in the CLI only to reject obvious usage errors before spending a
 * request; the server remains authoritative and rejects anything this misses.
 */
const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isAtlasServiceId(value: string): boolean {
  return (
    value.length > 0 && value.length <= 64 && SERVICE_ID_PATTERN.test(value)
  );
}

// ---------------------------------------------------------------------------
// Infrastructure diagnostics (ADR-032)
// ---------------------------------------------------------------------------

/** The catalog's read-only diagnostics route. */
export const ATLAS_INFRASTRUCTURE_DIAGNOSTICS_ROUTE_ID =
  "infrastructure.diagnostics.read";
export const ATLAS_INFRASTRUCTURE_DIAGNOSTICS_PATH =
  "/admin/infrastructure/diagnostics";

/**
 * The check-id prefixes the diagnostics commands filter on. These mirror
 * `src/infrastructure-diagnostics/domain/check-ids.ts`; the contract test pins
 * them to it.
 */
export const ATLAS_DIAGNOSTIC_CHECK_ID_PREFIX = Object.freeze({
  listener: "listener.",
  nginx: "nginx.",
  tunnel: "tunnel.",
} as const);

export const ATLAS_DIAGNOSTIC_NGINX_CONFIG_CHECK_ID = "nginx.config";

export type AtlasDiagnosticStatus =
  "ok" | "degraded" | "down" | "disabled" | "unavailable";

/**
 * The CLI's pinned copy of the server's `deriveOverallStatus` precedence.
 *
 * A copy exists for one structural reason: `tests/cli/no-direct-host-mutation.test.ts`
 * forbids the CLI from importing anything outside `src/cli/` and `node:`, and
 * the operator package ships only `dist/cli`. It is *not* an independent
 * second implementation — `tests/cli/administrative-contract.test.ts` asserts
 * it agrees with the domain function across an exhaustive status matrix, so a
 * change to the precedence rule fails there rather than letting the CLI and
 * the dashboard disagree about whether the system is healthy.
 *
 * The full-report status is computed server-side; this is used only to
 * summarize a *filtered subset* of checks for a command such as
 * `atlas nginx status`.
 */
export function atlasDiagnosticOverallStatus(
  checks: readonly Readonly<{ status: AtlasDiagnosticStatus }>[],
): AtlasDiagnosticStatus {
  const precedence: Readonly<Record<string, number>> = Object.freeze({
    down: 0,
    unavailable: 1,
    degraded: 2,
    ok: 3,
  });
  // A deliberately-disabled capability is excluded entirely: it must never
  // make a report read as an outage.
  const considered = checks.filter((check) => check.status !== "disabled");
  if (considered.length === 0) return "disabled";
  let worst: AtlasDiagnosticStatus = "ok";
  for (const check of considered)
    if ((precedence[check.status] ?? 3) < (precedence[worst] ?? 3))
      worst = check.status;
  return worst;
}
