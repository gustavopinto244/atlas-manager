import {
  createAdministrativePrincipal,
  type AdministrativePrincipal,
} from "./administrative-principal.js";

export type AdministrativeAuthenticationResult =
  | Readonly<{
      outcome: "authenticated";
      principal: AdministrativePrincipal;
    }>
  | Readonly<{
      outcome: "unauthenticated";
      reason: "credentials_absent" | "credentials_invalid";
    }>
  | Readonly<{
      outcome: "unavailable";
      reason: "identity_provider_unavailable";
    }>;

export function createAdministrativeAuthenticationResult(
  input: unknown,
): AdministrativeAuthenticationResult {
  if (!isRecord(input)) throw new Error("Invalid authentication result");
  const keys = Reflect.ownKeys(input);
  if (input["outcome"] === "authenticated") {
    if (keys.length !== 2 || !Object.hasOwn(input, "principal"))
      throw new Error("Invalid authentication result");
    return Object.freeze({
      outcome: "authenticated" as const,
      principal: createAdministrativePrincipal(input["principal"]),
    });
  }
  if (input["outcome"] === "unauthenticated") {
    if (
      keys.length !== 2 ||
      (input["reason"] !== "credentials_absent" &&
        input["reason"] !== "credentials_invalid")
    )
      throw new Error("Invalid authentication result");
    return Object.freeze({
      outcome: "unauthenticated" as const,
      reason: input["reason"],
    });
  }
  if (
    input["outcome"] === "unavailable" &&
    keys.length === 2 &&
    input["reason"] === "identity_provider_unavailable"
  )
    return Object.freeze({
      outcome: "unavailable" as const,
      reason: "identity_provider_unavailable" as const,
    });
  throw new Error("Invalid authentication result");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
