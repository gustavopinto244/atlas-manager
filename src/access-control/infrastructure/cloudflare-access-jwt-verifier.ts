import { jwtVerify } from "jose";

import type { CloudflareAccessJwksProvider } from "../application/ports/cloudflare-access-jwks-provider.js";
import type { CloudflareAccessJwtVerifier } from "../application/ports/cloudflare-access-jwt-verifier.js";
import {
  createAdministrativeAuthenticationResult,
  type AdministrativeAuthenticationResult,
} from "../domain/administrative-authentication-result.js";
import { createAdministrativePrincipal } from "../domain/administrative-principal.js";
import type { CloudflareAccessConfiguration } from "../domain/cloudflare-access-configuration.js";
import { type CloudflareAccessJwtAssertion } from "../domain/cloudflare-access-jwt-assertion.js";

const MAX_HEADER_BYTES = 4_096;
const MAX_PAYLOAD_BYTES = 8_192;
const MAX_SIGNATURE_BYTES = 1_024;
const CLOCK_TOLERANCE_SECONDS = 30;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const KID_PATTERN = /^[\x21-\x7e]+$/u;

export const CLOUDFLARE_ACCESS_JWT_CLOCK_TOLERANCE_SECONDS =
  CLOCK_TOLERANCE_SECONDS;

export class CloudflareAccessJwtVerificationError extends Error {
  public override readonly name = "CloudflareAccessJwtVerificationError";
  public readonly kind: CloudflareAccessJwtVerificationKind;

  public constructor(kind: CloudflareAccessJwtVerificationKind = "unknown") {
    super("Cloudflare Access assertion verification failed");
    this.kind = kind;
    Object.freeze(this);
  }
}

export type CloudflareAccessJwtVerificationKind =
  | "signature_invalid"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "claims_invalid"
  | "key_unavailable"
  | "unknown";

export class CloudflareAccessJwtVerifierAdapter implements CloudflareAccessJwtVerifier {
  readonly #configuration: CloudflareAccessConfiguration;
  readonly #jwksProvider: CloudflareAccessJwksProvider;

  public constructor(
    configuration: CloudflareAccessConfiguration,
    jwksProvider: CloudflareAccessJwksProvider,
  ) {
    this.#configuration = configuration;
    this.#jwksProvider = jwksProvider;
    Object.freeze(this);
  }

  public async verify(
    assertion: CloudflareAccessJwtAssertion,
    verificationTime: Date,
  ): Promise<AdministrativeAuthenticationResult> {
    try {
      const parts = splitAssertion(assertion);
      const header = decodeJsonSegment(parts.header, MAX_HEADER_BYTES);
      validateProtectedHeader(header);
      const payload = decodeJsonSegment(parts.payload, MAX_PAYLOAD_BYTES);
      const claims = validateClaims(payload, this.#configuration.audience);
      const verificationTimeMs = verificationTime.getTime();
      if (!Number.isFinite(verificationTimeMs))
        throw new CloudflareAccessJwtVerificationError("claims_invalid");
      validateTemporalClaims(claims, verificationTime);
      let key: CryptoKey;
      try {
        key = await this.#jwksProvider.resolveKey(header.kid, verificationTime);
      } catch (keyError) {
        if (isUnavailable(keyError))
          return createAdministrativeAuthenticationResult({
            outcome: "unavailable",
            reason: "identity_provider_unavailable",
          });
        if (
          keyError instanceof Error &&
          keyError.name === "CloudflareAccessJwksKeyNotFoundError"
        )
          return createAdministrativeAuthenticationResult({
            outcome: "unauthenticated",
            reason: "key_unavailable",
          });
        return createAdministrativeAuthenticationResult({
          outcome: "unavailable",
          reason: "identity_provider_unavailable",
        });
      }
      try {
        await jwtVerify(assertion, key, {
          algorithms: ["RS256"],
          audience: this.#configuration.audience,
          currentDate: verificationTime,
          issuer: this.#configuration.issuer,
          requiredClaims: ["iss", "aud", "sub", "exp", "iat", "type"],
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
        });
      } catch (verifyError) {
        if (isUnavailable(verifyError))
          return createAdministrativeAuthenticationResult({
            outcome: "unavailable",
            reason: "identity_provider_unavailable",
          });
        const reason = mapJwtVerifyErrorToReason(verifyError);
        return createAdministrativeAuthenticationResult({
          outcome: "unauthenticated",
          reason,
        });
      }
      const principal = createAdministrativePrincipal({
        principalId: claims.sub,
      });
      return createAdministrativeAuthenticationResult({
        outcome: "authenticated",
        principal,
      });
    } catch (error) {
      if (isUnavailable(error))
        return createAdministrativeAuthenticationResult({
          outcome: "unavailable",
          reason: "identity_provider_unavailable",
        });
      const reason = extractVerificationReason(error);
      return createAdministrativeAuthenticationResult({
        outcome: "unauthenticated",
        reason,
      });
    }
  }
}

function splitAssertion(assertion: string): {
  header: string;
  payload: string;
  signature: string;
} {
  const parts = assertion.split(".");
  const [header, payload, signature] = parts;
  if (
    parts.length !== 3 ||
    header === undefined ||
    payload === undefined ||
    signature === undefined ||
    parts.some((part) => part.length === 0 || !BASE64URL_PATTERN.test(part))
  )
    throw new CloudflareAccessJwtVerificationError();
  const signatureBytes = decodeBase64Url(signature);
  if (signatureBytes.byteLength > MAX_SIGNATURE_BYTES)
    throw new CloudflareAccessJwtVerificationError();
  return { header, payload, signature };
}

function decodeJsonSegment(
  input: string,
  maximumBytes: number,
): Record<string, unknown> {
  const bytes = decodeBase64Url(input);
  if (bytes.byteLength > maximumBytes)
    throw new CloudflareAccessJwtVerificationError();
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new CloudflareAccessJwtVerificationError();
  }
  if (!isRecord(value)) throw new CloudflareAccessJwtVerificationError();
  return value;
}

function decodeBase64Url(input: string): Uint8Array {
  if (
    input.length === 0 ||
    input.includes("=") ||
    !BASE64URL_PATTERN.test(input) ||
    input.length % 4 === 1
  )
    throw new CloudflareAccessJwtVerificationError();
  const normalized = input.replace(/-/gu, "+").replace(/_/gu, "/");
  try {
    const bytes = Uint8Array.from(Buffer.from(normalized, "base64"));
    const canonical = Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/u, "");
    if (canonical !== input) throw new CloudflareAccessJwtVerificationError();
    return bytes;
  } catch {
    throw new CloudflareAccessJwtVerificationError();
  }
}

function validateProtectedHeader(
  input: Record<string, unknown>,
): asserts input is Record<string, unknown> & {
  alg: "RS256";
  typ?: "JWT";
  kid: string;
} {
  if (
    input["alg"] !== "RS256" ||
    (input["typ"] !== undefined && input["typ"] !== "JWT") ||
    typeof input["kid"] !== "string" ||
    input["kid"].length < 1 ||
    input["kid"].length > 128 ||
    !KID_PATTERN.test(input["kid"]) ||
    input["jku"] !== undefined ||
    input["jwk"] !== undefined ||
    input["x5u"] !== undefined ||
    input["x5c"] !== undefined ||
    (input["crit"] !== undefined &&
      (!Array.isArray(input["crit"]) ? true : input["crit"].length !== 0))
  )
    throw new CloudflareAccessJwtVerificationError();
}

type ValidClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  nbf?: number;
  type: "app";
};

function validateClaims(
  input: Record<string, unknown>,
  expectedAudience: string,
): ValidClaims {
  const iss = input["iss"];
  const aud = input["aud"];
  const sub = input["sub"];
  const exp = input["exp"];
  const iat = input["iat"];
  const nbf = input["nbf"];
  if (typeof iss !== "string")
    throw new CloudflareAccessJwtVerificationError("claims_invalid");
  if (!isAudience(aud))
    throw new CloudflareAccessJwtVerificationError("claims_invalid");
  if (!audienceContains(aud, expectedAudience))
    throw new CloudflareAccessJwtVerificationError("audience_mismatch");
  if (typeof sub !== "string")
    throw new CloudflareAccessJwtVerificationError("claims_invalid");
  if (input["type"] !== "app")
    throw new CloudflareAccessJwtVerificationError("claims_invalid");
  if (!isSafeInteger(exp) || !isSafeInteger(iat))
    throw new CloudflareAccessJwtVerificationError("claims_invalid");
  if (nbf !== undefined && !isSafeInteger(nbf))
    throw new CloudflareAccessJwtVerificationError("claims_invalid");
  return {
    iss,
    aud,
    sub,
    exp,
    iat,
    ...(nbf === undefined ? {} : { nbf }),
    type: "app",
  };
}

function validateTemporalClaims(
  claims: ValidClaims,
  verificationTime: Date,
): void {
  const now = verificationTime.getTime() / 1_000;
  if (
    claims.iat > claims.exp ||
    (claims.nbf !== undefined && claims.nbf > claims.exp) ||
    claims.exp + CLOCK_TOLERANCE_SECONDS < now ||
    claims.iat > now + CLOCK_TOLERANCE_SECONDS ||
    (claims.nbf !== undefined && claims.nbf > now + CLOCK_TOLERANCE_SECONDS)
  )
    throw new CloudflareAccessJwtVerificationError();
}

function audienceContains(
  audience: string | string[],
  expected: string,
): boolean {
  return Array.isArray(audience)
    ? audience.some((value) => value === expected)
    : audience === expected;
}

function isAudience(value: unknown): value is string | string[] {
  if (typeof value === "string") return value.length > 0;
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function mapJwtVerifyErrorToReason(
  error: unknown,
): "signature_invalid" | "issuer_mismatch" | "claims_invalid" {
  if (!(error instanceof Error)) return "claims_invalid";
  const message = error.message.toLowerCase();
  if (message.includes("signature") || message.includes("invalid signature"))
    return "signature_invalid";
  if (message.includes("issuer") || message.includes('"iss"'))
    return "issuer_mismatch";
  return "claims_invalid";
}

function extractVerificationReason(
  error: unknown,
):
  | "signature_invalid"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "claims_invalid"
  | "key_unavailable" {
  if (error instanceof CloudflareAccessJwtVerificationError) {
    const { kind } = error;
    if (kind === "audience_mismatch") return "audience_mismatch";
    if (kind === "signature_invalid") return "signature_invalid";
    if (kind === "key_unavailable") return "key_unavailable";
    if (kind === "issuer_mismatch") return "issuer_mismatch";
    return "claims_invalid";
  }
  if (!(error instanceof Error)) return "claims_invalid";
  const message = error.message.toLowerCase();
  if (message.includes("issuer") || message.includes('"iss"'))
    return "issuer_mismatch";
  if (message.includes("audience") || message.includes('"aud"'))
    return "audience_mismatch";
  if (message.includes("signature") || message.includes("invalid signature"))
    return "signature_invalid";
  return "claims_invalid";
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "CloudflareAccessJwksUnavailableError" ||
      error.name === "CloudflareAccessJwksInvalidError")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
