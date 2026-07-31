import type { AdministrativePrincipal } from "../../domain/administrative-principal.js";
import type { AdministrativeRole } from "../../domain/administrative-role.js";

export type AdministrativeRoleAssignmentResult =
  | Readonly<{
      outcome: "assigned";
      roles: readonly AdministrativeRole[];
    }>
  | Readonly<{ outcome: "unknown_principal" }>
  | Readonly<{ outcome: "unavailable" }>;

export interface AdministrativeRoleAssignmentReader {
  read(
    principal: AdministrativePrincipal,
  ): Promise<AdministrativeRoleAssignmentResult>;
}
