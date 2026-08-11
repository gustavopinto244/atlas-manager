import { isCanonicalAdministrativePrincipalId } from "./administrative-principal.js";

/**
 * The operator-configured mapping from a Cloudflare Access **service token**
 * to an administrative principal id (ADR-034).
 *
 * Cloudflare issues a signed assertion for a service token just as it does for
 * an interactive login, but the identity arrives differently: `sub` is empty
 * and the caller is named by `common_name`, which carries the token's Client
 * ID. That Client ID is not a canonical UUID, and the rest of this system —
 * role assignments, authorization decisions, the audit trail — is built on
 * canonical principal ids.
 *
 * Rather than widen the principal id format for every caller, an operator
 * declares which Client IDs are recognised and which principal id each one
 * acts as. Two consequences are deliberate:
 *
 *   - a service token that is not declared here authenticates as nobody, even
 *     though Cloudflare accepted it. Reaching the origin is not authorisation;
 *   - a declared service token still gets its roles from the ordinary
 *     `ADMINISTRATIVE_ROLE_ASSIGNMENTS` table, so RBAC has exactly one shape.
 *
 * The Client ID is only ever used as an exact lookup key, never as a trust
 * decision in itself.
 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;

export type CloudflareAccessServiceTokenPrincipals = Readonly<{
  /** Resolves a `common_name` to a principal id, or undefined when undeclared. */
  resolve(clientId: string): string | undefined;
  /** Declared Client IDs, for configuration reporting. Never includes secrets. */
  readonly clientIds: readonly string[];
}>;

export class CloudflareAccessServiceTokenPrincipalsError extends Error {
  public override readonly name = "CloudflareAccessServiceTokenPrincipalsError";
  public constructor(
    public readonly code:
      | "service_token_principals_invalid"
      | "service_token_client_id_invalid"
      | "service_token_principal_id_invalid"
      | "service_token_client_id_duplicated",
  ) {
    super(`Invalid Cloudflare Access service-token principals: ${code}`);
    Object.freeze(this);
  }
}

export function createCloudflareAccessServiceTokenPrincipals(
  input: unknown,
): CloudflareAccessServiceTokenPrincipals {
  if (input === undefined) return emptyServiceTokenPrincipals();
  if (!Array.isArray(input))
    throw new CloudflareAccessServiceTokenPrincipalsError(
      "service_token_principals_invalid",
    );
  const mapping = new Map<string, string>();
  for (const entry of input) {
    if (!isRecord(entry) || Reflect.ownKeys(entry).length !== 2)
      throw new CloudflareAccessServiceTokenPrincipalsError(
        "service_token_principals_invalid",
      );
    const clientId = entry["clientId"];
    const principalId = entry["principalId"];
    if (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId))
      throw new CloudflareAccessServiceTokenPrincipalsError(
        "service_token_client_id_invalid",
      );
    if (!isCanonicalAdministrativePrincipalId(principalId))
      throw new CloudflareAccessServiceTokenPrincipalsError(
        "service_token_principal_id_invalid",
      );
    if (mapping.has(clientId))
      throw new CloudflareAccessServiceTokenPrincipalsError(
        "service_token_client_id_duplicated",
      );
    mapping.set(clientId, principalId);
  }
  const clientIds = Object.freeze([...mapping.keys()]);
  return Object.freeze({
    resolve: (clientId: string): string | undefined => {
      // Own-property lookup on a Map; a prototype-polluted key cannot resolve.
      return mapping.get(clientId);
    },
    clientIds,
  });
}

export function emptyServiceTokenPrincipals(): CloudflareAccessServiceTokenPrincipals {
  return Object.freeze({
    resolve: () => undefined,
    clientIds: Object.freeze([]),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
