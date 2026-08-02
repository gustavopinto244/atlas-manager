import { parseStrictJson } from "./strict-json.js";
import { parseEnvironment } from "./environment.js";
import { createRegisteredServiceCatalogFromEnvironment } from "../service-management/infrastructure/environment-registered-service-catalog.js";
import { parseAdministrativePublicOrigin } from "../http/administrative-public-origin.js";

export interface MockAdministrativeInput {
  readonly schemaVersion: 1;
  readonly cloudflareTeamName: string;
  readonly cloudflareAudience: string;
  readonly publicOrigin: string;
  readonly roleAssignments: readonly Readonly<{
    readonly principalId: string;
    readonly roles: readonly string[];
  }>[];
  readonly registeredServices: readonly unknown[];
  readonly backupSchedulerEnabled: boolean;
  readonly backupTargets: readonly unknown[];
  readonly eventHistoryOperations: Readonly<{
    readonly enabled: true;
    readonly segment: Readonly<{
      readonly maxEvents: number;
      readonly maxBytes: number;
    }>;
    readonly retention: unknown;
  }>;
}

export function parseMockAdministrativeInput(
  value: string,
): MockAdministrativeInput {
  const parsed = parseStrictJson(value);
  if (
    !isRecord(parsed) ||
    Reflect.ownKeys(parsed).length !== 9 ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.cloudflareTeamName !== "string" ||
    typeof parsed.cloudflareAudience !== "string" ||
    typeof parsed.publicOrigin !== "string" ||
    !Array.isArray(parsed.roleAssignments) ||
    !Array.isArray(parsed.registeredServices) ||
    typeof parsed.backupSchedulerEnabled !== "boolean" ||
    !Array.isArray(parsed.backupTargets) ||
    !isRecord(parsed.eventHistoryOperations)
  )
    throw new Error("administrative_input_invalid");
  parseAdministrativePublicOrigin(parsed.publicOrigin);
  const roleAssignments = parsed.roleAssignments.map((assignment) => {
    if (
      !isRecord(assignment) ||
      Reflect.ownKeys(assignment).length !== 2 ||
      typeof assignment.principalId !== "string" ||
      !Array.isArray(assignment.roles)
    )
      throw new Error("administrative_input_invalid");
    return Object.freeze({
      principalId: assignment.principalId,
      roles: Object.freeze(
        assignment.roles.map((role) => {
          if (typeof role !== "string")
            throw new Error("administrative_input_invalid");
          return role;
        }),
      ),
    });
  });
  if (
    !roleAssignments.some((assignment) =>
      assignment.roles.includes("administrator"),
    )
  )
    throw new Error("administrative_input_invalid");
  const history = parsed.eventHistoryOperations;
  if (
    Reflect.ownKeys(history).length !== 3 ||
    history.enabled !== true ||
    !isRecord(history.segment) ||
    !isRecord(history.retention) ||
    Reflect.ownKeys(history.segment).length !== 2 ||
    typeof history.segment.maxEvents !== "number" ||
    typeof history.segment.maxBytes !== "number"
  )
    throw new Error("administrative_input_invalid");
  return Object.freeze({
    schemaVersion: 1,
    cloudflareTeamName: parsed.cloudflareTeamName,
    cloudflareAudience: parsed.cloudflareAudience,
    publicOrigin: parsed.publicOrigin,
    roleAssignments: Object.freeze(roleAssignments),
    registeredServices: Object.freeze(parsed.registeredServices),
    backupSchedulerEnabled: parsed.backupSchedulerEnabled,
    backupTargets: Object.freeze(parsed.backupTargets),
    eventHistoryOperations: Object.freeze({
      enabled: true,
      segment: Object.freeze({
        maxEvents: history.segment.maxEvents,
        maxBytes: history.segment.maxBytes,
      }),
      retention: history.retention,
    }),
  });
}

export function createMockAdministrativeEnvironment(
  input: MockAdministrativeInput,
): Readonly<Record<string, string>> {
  const roleAssignments = JSON.stringify(input.roleAssignments);
  const services = JSON.stringify(input.registeredServices);
  const environment = Object.freeze({
    HOST: "127.0.0.1",
    PORT: "3000",
    LOG_LEVEL: "info",
    POWER_MANAGEMENT_BACKEND: "mock",
    MACHINE_POWER_EFFECTS_ACTIVATION: "disabled",
    MACHINE_POWER_SCHEDULER_ENABLED: "false",
    MACHINE_OPERATING_POLICY: '{"mode":"always_on"}',
    ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED: "true",
    ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED: "true",
    ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED: "true",
    ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED: "true",
    ADMINISTRATIVE_DASHBOARD_ENABLED: "true",
    ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED: "false",
    ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED: "false",
    CLOUDFLARE_ACCESS_TEAM_NAME: input.cloudflareTeamName,
    CLOUDFLARE_ACCESS_AUDIENCE: input.cloudflareAudience,
    ADMINISTRATIVE_PUBLIC_ORIGIN: input.publicOrigin,
    ADMINISTRATIVE_ROLE_ASSIGNMENTS: roleAssignments,
    REGISTERED_SERVICES_JSON: services,
    ADMINISTRATIVE_BACKUP_HTTP_ENABLED: "true",
    REGISTERED_BACKUP_TARGETS_JSON: JSON.stringify(input.backupTargets),
    ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED: "true",
    ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED: "true",
    ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY:
      "/var/lib/atlas-manager-event-history",
    ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_EVENTS: String(
      input.eventHistoryOperations.segment.maxEvents,
    ),
    ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_BYTES: String(
      input.eventHistoryOperations.segment.maxBytes,
    ),
    ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY: JSON.stringify({
      schemaVersion: 1,
      ...(input.eventHistoryOperations.retention as Record<string, unknown>),
    }),
    ADMINISTRATIVE_EVENT_HISTORY_AUTOMATIC_RETENTION_ENABLED: "false",
    BACKUP_SCHEDULER_ENABLED: input.backupSchedulerEnabled ? "true" : "false",
    BACKUP_RUN_HISTORY_FILE: "/var/lib/atlas-manager-backups/runs.jsonl",
    ...(input.backupSchedulerEnabled
      ? {
          BACKUP_SCHEDULER_CURSOR_FILE:
            "/var/lib/atlas-manager-backups/scheduler-cursor.json",
          BACKUP_OCCURRENCE_CLAIM_FILE:
            "/var/lib/atlas-manager-backups/occurrence-claims.jsonl",
        }
      : {}),
  });
  parseEnvironment(environment);
  createRegisteredServiceCatalogFromEnvironment(environment);
  return environment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
