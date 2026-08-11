const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Who an administrative request is acting as (ADR-034).
 *
 * `human` is an operator who passed an interactive Cloudflare Access login.
 * `service` is a non-interactive caller that presented a Cloudflare Access
 * service token — the CLI, CI, a scheduled job.
 *
 * The distinction is deliberately carried in the domain rather than inferred
 * downstream: a service identity must never be able to appear in the audit
 * trail as a human operator, and "a person approved this" is exactly the claim
 * an audit trail exists to answer.
 */
export type AdministrativePrincipalKind = "human" | "service";

export type AdministrativePrincipal = Readonly<{
  principalId: string;
  kind: AdministrativePrincipalKind;
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
  if (!isRecord(input)) {
    throw new AdministrativePrincipalValidationError("invalid_principal");
  }
  const keys = Reflect.ownKeys(input);
  // `kind` is optional on input and defaults to `human`. Role assignments and
  // configuration name a principal by id alone; only an authentication result
  // that actually observed a service token asserts `service`.
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    !keys.includes("principalId") ||
    (keys.length === 2 && !keys.includes("kind"))
  ) {
    throw new AdministrativePrincipalValidationError("invalid_principal");
  }
  const principalId = input["principalId"];
  if (typeof principalId !== "string" || !CANONICAL_UUID.test(principalId)) {
    throw new AdministrativePrincipalValidationError("invalid_principal");
  }
  const kind = keys.includes("kind") ? input["kind"] : "human";
  if (kind !== "human" && kind !== "service") {
    throw new AdministrativePrincipalValidationError("invalid_principal");
  }
  return Object.freeze({ principalId, kind });
}

export function isCanonicalAdministrativePrincipalId(
  value: unknown,
): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

/**
 * The audit actor id for a principal. The prefix is the only thing separating
 * a human operator from a service token in the event history, so it is derived
 * from the principal kind and never passed in by a caller.
 */
export function administrativePrincipalActorId(
  principal: AdministrativePrincipal,
): `administrator:${string}` | `service:${string}` {
  return principal.kind === "service"
    ? `service:${principal.principalId}`
    : `administrator:${principal.principalId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
