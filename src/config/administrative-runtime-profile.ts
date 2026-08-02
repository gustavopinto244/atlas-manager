import { parseStrictJson } from "./strict-json.js";
import { parseEnvironment } from "./environment.js";
import { createRegisteredServiceCatalogFromEnvironment } from "../service-management/infrastructure/environment-registered-service-catalog.js";

export interface MockAdministrativeInput {
  readonly schemaVersion: 1;
  readonly cloudflareTeamName: string;
  readonly cloudflareAudience: string;
  readonly roleAssignments: readonly Readonly<{
    readonly principalId: string;
    readonly roles: readonly string[];
  }>[];
  readonly registeredServices: readonly unknown[];
}

export function parseMockAdministrativeInput(
  value: string,
): MockAdministrativeInput {
  const parsed = parseStrictJson(value);
  if (
    !isRecord(parsed) ||
    Reflect.ownKeys(parsed).length !== 5 ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.cloudflareTeamName !== "string" ||
    typeof parsed.cloudflareAudience !== "string" ||
    !Array.isArray(parsed.roleAssignments) ||
    !Array.isArray(parsed.registeredServices)
  )
    throw new Error("administrative_input_invalid");
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
  return Object.freeze({
    schemaVersion: 1,
    cloudflareTeamName: parsed.cloudflareTeamName,
    cloudflareAudience: parsed.cloudflareAudience,
    roleAssignments: Object.freeze(roleAssignments),
    registeredServices: Object.freeze(parsed.registeredServices),
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
    ADMINISTRATIVE_EVENT_HISTORY_FILE:
      "/var/lib/atlas-manager/admin-events.jsonl",
    CLOUDFLARE_ACCESS_TEAM_NAME: input.cloudflareTeamName,
    CLOUDFLARE_ACCESS_AUDIENCE: input.cloudflareAudience,
    ADMINISTRATIVE_ROLE_ASSIGNMENTS: roleAssignments,
    REGISTERED_SERVICES_JSON: services,
  });
  parseEnvironment(environment);
  createRegisteredServiceCatalogFromEnvironment(environment);
  return environment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
