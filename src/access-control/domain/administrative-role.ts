export const ADMINISTRATIVE_ROLES = Object.freeze([
  "power_operator",
  "scheduler_operator",
  "auditor",
  "service_operator",
  "administrator",
] as const);

export type AdministrativeRole = (typeof ADMINISTRATIVE_ROLES)[number];

export class AdministrativeRoleValidationError extends Error {
  public override readonly name = "AdministrativeRoleValidationError";
  public constructor(
    public readonly code: "invalid_role" | "invalid_role_collection",
  ) {
    super(`Invalid administrative role: ${code}`);
    Object.freeze(this);
  }
}

export function createAdministrativeRole(input: unknown): AdministrativeRole {
  if (
    typeof input !== "string" ||
    !(ADMINISTRATIVE_ROLES as readonly string[]).includes(input)
  )
    throw new AdministrativeRoleValidationError("invalid_role");
  return input as AdministrativeRole;
}

export function createAdministrativeRoleCollection(
  input: unknown,
): readonly AdministrativeRole[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 5)
    throw new AdministrativeRoleValidationError("invalid_role_collection");
  const roles = input.map(createAdministrativeRole);
  if (new Set(roles).size !== roles.length)
    throw new AdministrativeRoleValidationError("invalid_role_collection");
  return Object.freeze([...roles]);
}
