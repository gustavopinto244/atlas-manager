const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type AdministrativePrincipal = Readonly<{
  principalId: string;
}>;

export class AdministrativePrincipalValidationError extends Error {
  public override readonly name = "AdministrativePrincipalValidationError";
  public constructor(public readonly code: "invalid_principal") {
    super(`Invalid administrative principal: ${code}`);
    Object.freeze(this);
  }
}

export function createAdministrativePrincipal(
  input: unknown,
): AdministrativePrincipal {
  if (!isRecord(input) || Reflect.ownKeys(input).length !== 1) {
    throw new AdministrativePrincipalValidationError("invalid_principal");
  }
  const principalId = input["principalId"];
  if (typeof principalId !== "string" || !CANONICAL_UUID.test(principalId)) {
    throw new AdministrativePrincipalValidationError("invalid_principal");
  }
  return Object.freeze({ principalId });
}

export function isCanonicalAdministrativePrincipalId(
  value: unknown,
): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

export function administrativePrincipalActorId(
  principal: AdministrativePrincipal,
): `administrator:${string}` {
  return `administrator:${principal.principalId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
