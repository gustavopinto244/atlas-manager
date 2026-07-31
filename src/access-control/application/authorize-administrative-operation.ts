import { isCanonicalTimestamp } from "../../power-management/domain/canonical-timestamp.js";
import {
  createAdministrativeAuthorizationDecision,
  createAllowedAdministrativeAuthorizationDecision,
  createDeniedAdministrativeAuthorizationDecision,
  type AdministrativeAuthorizationDecision,
} from "../domain/administrative-authorization-decision.js";
import {
  createAdministrativeOperation,
  permissionForAdministrativeOperation,
  roleHasAdministrativePermission,
  type AdministrativeOperation,
} from "../domain/administrative-operation.js";
import { createAdministrativePrincipal } from "../domain/administrative-principal.js";
import type { AdministrativeRoleAssignmentReader } from "./ports/administrative-role-assignment-reader.js";

export interface AuthorizeAdministrativeOperationInput {
  readonly principal: unknown;
  readonly operation: unknown;
  readonly evaluatedAt: string;
}

export class AuthorizeAdministrativeOperation {
  readonly #roles: AdministrativeRoleAssignmentReader;
  public constructor(roles: AdministrativeRoleAssignmentReader) {
    this.#roles = roles;
    Object.freeze(this);
  }

  public async execute(
    input: AuthorizeAdministrativeOperationInput,
  ): Promise<AdministrativeAuthorizationDecision> {
    const principal = createAdministrativePrincipal(input.principal);
    const operation = createAdministrativeOperation(input.operation);
    if (!isCanonicalTimestamp(input.evaluatedAt))
      throw new Error("Invalid authorization evaluation timestamp");
    const permission = permissionForAdministrativeOperation(operation);
    let assignment;
    try {
      assignment = await this.#roles.read(principal);
    } catch {
      return createDeniedAdministrativeAuthorizationDecision({
        principal,
        operation,
        evaluatedAt: input.evaluatedAt,
        reason: "role_assignment_unavailable",
      });
    }
    if (assignment.outcome === "unknown_principal")
      return createDeniedAdministrativeAuthorizationDecision({
        principal,
        operation,
        evaluatedAt: input.evaluatedAt,
        reason: "principal_unknown",
      });
    if (assignment.outcome === "unavailable")
      return createDeniedAdministrativeAuthorizationDecision({
        principal,
        operation,
        evaluatedAt: input.evaluatedAt,
        reason: "role_assignment_unavailable",
      });
    try {
      const allowed = assignment.roles.some((role) =>
        roleHasAdministrativePermission(role, permission),
      );
      return allowed
        ? createAllowedAdministrativeAuthorizationDecision({
            principal,
            operation,
            evaluatedAt: input.evaluatedAt,
          })
        : createDeniedAdministrativeAuthorizationDecision({
            principal,
            operation,
            evaluatedAt: input.evaluatedAt,
            reason: "permission_denied",
          });
    } catch {
      return createAdministrativeAuthorizationDecision({
        principal,
        operation,
        permission,
        evaluatedAt: input.evaluatedAt,
        outcome: "denied",
        reason: "authorization_policy_unavailable",
      });
    }
  }
}

export type { AdministrativeOperation };
