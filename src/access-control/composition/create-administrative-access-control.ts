import { AuthenticateAdministrativeRequest } from "../application/authenticate-administrative-request.js";
import { AuthorizeAdministrativeOperation } from "../application/authorize-administrative-operation.js";
import type { AdministrativeAuthenticationProvider } from "../application/ports/administrative-authentication-provider.js";
import type { AdministrativeRoleAssignmentReader } from "../application/ports/administrative-role-assignment-reader.js";
import { DenyAllAdministrativeAuthenticationProvider } from "../infrastructure/deny-all-administrative-authentication-provider.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "../infrastructure/in-memory-administrative-role-assignment-reader.js";

export interface AdministrativeAccessControlCompositionOverrides {
  readonly authenticator?: AdministrativeAuthenticationProvider;
  readonly roleAssignmentReader?: AdministrativeRoleAssignmentReader;
}

export interface AdministrativeAccessControlCapabilities {
  readonly authenticateAdministrativeRequest: AuthenticateAdministrativeRequest;
  readonly authorizeAdministrativeOperation: AuthorizeAdministrativeOperation;
}

export function createAdministrativeAccessControl(
  overrides: AdministrativeAccessControlCompositionOverrides = {},
): AdministrativeAccessControlCapabilities {
  if (
    Reflect.ownKeys(overrides).some(
      (key) => key !== "authenticator" && key !== "roleAssignmentReader",
    )
  )
    throw new Error("Invalid administrative access-control configuration");
  const authenticator =
    overrides.authenticator ??
    new DenyAllAdministrativeAuthenticationProvider();
  const roleAssignmentReader =
    overrides.roleAssignmentReader ??
    new InMemoryAdministrativeRoleAssignmentReader();
  return Object.freeze({
    authenticateAdministrativeRequest: new AuthenticateAdministrativeRequest(
      authenticator,
    ),
    authorizeAdministrativeOperation: new AuthorizeAdministrativeOperation(
      roleAssignmentReader,
    ),
  });
}
