import { isCanonicalTimestamp } from "../../power-management/domain/canonical-timestamp.js";
import {
  createAdministrativeOperation,
  permissionForAdministrativeOperation,
  type AdministrativeOperation,
} from "./administrative-operation.js";
import {
  createAdministrativePermission,
  type AdministrativePermission,
} from "./administrative-permission.js";
import {
  createAdministrativePrincipal,
  type AdministrativePrincipal,
} from "./administrative-principal.js";

export const ADMINISTRATIVE_AUTHORIZATION_DENY_REASONS = Object.freeze([
  "principal_unknown",
  "permission_denied",
  "role_assignment_unavailable",
  "authorization_policy_unavailable",
] as const);
export type AdministrativeAuthorizationDenyReason =
  (typeof ADMINISTRATIVE_AUTHORIZATION_DENY_REASONS)[number];

export type AdministrativeAuthorizationDecision = Readonly<{
  principal: AdministrativePrincipal;
  operation: AdministrativeOperation;
  permission: AdministrativePermission;
  evaluatedAt: string;
  outcome: "allowed" | "denied";
  reason?: AdministrativeAuthorizationDenyReason;
}>;

export function createAdministrativeAuthorizationDecision(
  input: unknown,
): AdministrativeAuthorizationDecision {
  if (!isRecord(input)) throw new Error("Invalid authorization decision");
  const keys = Reflect.ownKeys(input);
  const principal = createAdministrativePrincipal(input["principal"]);
  const operation = createAdministrativeOperation(input["operation"]);
  const permission = createAdministrativePermission(input["permission"]);
  if (permission !== permissionForAdministrativeOperation(operation))
    throw new Error("Invalid authorization decision");
  const evaluatedAt = input["evaluatedAt"];
  if (!isCanonicalTimestamp(evaluatedAt))
    throw new Error("Invalid authorization decision");
  const outcome = input["outcome"];
  if (outcome === "allowed") {
    if (keys.length !== 5 || Object.hasOwn(input, "reason"))
      throw new Error("Invalid authorization decision");
    return Object.freeze({
      principal,
      operation,
      permission,
      evaluatedAt,
      outcome: "allowed" as const,
    });
  }
  const reason = input["reason"];
  if (
    outcome !== "denied" ||
    keys.length !== 6 ||
    typeof reason !== "string" ||
    !(ADMINISTRATIVE_AUTHORIZATION_DENY_REASONS as readonly string[]).includes(
      reason,
    )
  )
    throw new Error("Invalid authorization decision");
  return Object.freeze({
    principal,
    operation,
    permission,
    evaluatedAt,
    outcome: "denied" as const,
    reason: reason as AdministrativeAuthorizationDenyReason,
  });
}

export function createAllowedAdministrativeAuthorizationDecision(input: {
  readonly principal: AdministrativePrincipal;
  readonly operation: AdministrativeOperation;
  readonly evaluatedAt: string;
}): AdministrativeAuthorizationDecision {
  return createAdministrativeAuthorizationDecision({
    ...input,
    permission: permissionForAdministrativeOperation(input.operation),
    outcome: "allowed",
  });
}

export function createDeniedAdministrativeAuthorizationDecision(input: {
  readonly principal: AdministrativePrincipal;
  readonly operation: AdministrativeOperation;
  readonly evaluatedAt: string;
  readonly reason: AdministrativeAuthorizationDenyReason;
}): AdministrativeAuthorizationDecision {
  return createAdministrativeAuthorizationDecision({
    ...input,
    permission: permissionForAdministrativeOperation(input.operation),
    outcome: "denied",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
