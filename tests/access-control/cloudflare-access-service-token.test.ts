import { generateKeyPairSync } from "node:crypto";

import { exportJWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createCloudflareAccessConfiguration } from "../../src/access-control/domain/cloudflare-access-configuration.js";
import { createCloudflareAccessJwtAssertion } from "../../src/access-control/domain/cloudflare-access-jwt-assertion.js";
import { createCloudflareAccessServiceTokenPrincipals } from "../../src/access-control/domain/cloudflare-access-service-token-principals.js";
import {
  CloudflareAccessJwksProvider,
  type CloudflareAccessJwksFetch,
} from "../../src/access-control/infrastructure/cloudflare-access-jwks-provider.js";
import { CloudflareAccessJwtVerifierAdapter } from "../../src/access-control/infrastructure/cloudflare-access-jwt-verifier.js";

const HUMAN_PRINCIPAL_ID = "caf45cc3-4312-5d41-8603-cc0102346a1f";
const SERVICE_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000002";
const CLIENT_ID = "0123456789abcdef0123456789abcdef.access";
const NOW = new Date("2026-07-31T12:00:00.000Z");

const PRINCIPALS = createCloudflareAccessServiceTokenPrincipals([
  { clientId: CLIENT_ID, principalId: SERVICE_PRINCIPAL_ID },
]);

async function createVerifier(serviceTokenPrincipals = PRINCIPALS): Promise<{
  verify: (claims: Record<string, unknown>) => Promise<unknown>;
}> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    alg: "RS256",
    kid: "K1",
    use: "sig",
  };
  const configuration = createCloudflareAccessConfiguration({
    teamName: "atlas",
    audience: "atlas-admin",
  });
  const fetch: CloudflareAccessJwksFetch = async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  const verifier = new CloudflareAccessJwtVerifierAdapter(
    configuration,
    new CloudflareAccessJwksProvider(configuration, { fetch }),
    serviceTokenPrincipals,
  );
  return {
    verify: async (claims) => {
      const token = await new SignJWT({
        aud: configuration.audience,
        exp: Math.floor(NOW.getTime() / 1_000) + 300,
        iat: Math.floor(NOW.getTime() / 1_000),
        iss: configuration.issuer,
        type: "app",
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "K1", typ: "JWT" })
        .sign(privateKey);
      return verifier.verify(createCloudflareAccessJwtAssertion(token), NOW);
    },
  };
}

describe("Cloudflare Access service-token authentication (ADR-034)", () => {
  // Cloudflare's service-token assertion shape: empty `sub`, identity in
  // `common_name`.
  it("authenticates a declared service token as a service principal", async () => {
    const { verify } = await createVerifier();
    await expect(verify({ sub: "", common_name: CLIENT_ID })).resolves.toEqual({
      outcome: "authenticated",
      principal: { principalId: SERVICE_PRINCIPAL_ID, kind: "service" },
    });
  });

  it("still authenticates an interactive login as a human principal", async () => {
    const { verify } = await createVerifier();
    await expect(verify({ sub: HUMAN_PRINCIPAL_ID })).resolves.toEqual({
      outcome: "authenticated",
      principal: { principalId: HUMAN_PRINCIPAL_ID, kind: "human" },
    });
  });

  // Reaching the origin is not authorisation: Cloudflare accepting the token
  // says nothing about this deployment recognising it.
  it("refuses a service token this deployment has not declared", async () => {
    const { verify } = await createVerifier();
    await expect(
      verify({
        sub: "",
        common_name: "undeclared0000000000000000000000.access",
      }),
    ).resolves.toEqual({
      outcome: "unauthenticated",
      reason: "claims_invalid",
    });
  });

  it("refuses every service token when none are declared", async () => {
    const { verify } = await createVerifier(
      createCloudflareAccessServiceTokenPrincipals(undefined),
    );
    await expect(verify({ sub: "", common_name: CLIENT_ID })).resolves.toEqual({
      outcome: "unauthenticated",
      reason: "claims_invalid",
    });
  });

  // A common_name must never override a real `sub`, or a service token could
  // be presented as an operator.
  it("never lets common_name displace a human sub", async () => {
    const { verify } = await createVerifier();
    await expect(
      verify({ sub: HUMAN_PRINCIPAL_ID, common_name: CLIENT_ID }),
    ).resolves.toEqual({
      outcome: "authenticated",
      principal: { principalId: HUMAN_PRINCIPAL_ID, kind: "human" },
    });
  });

  it("refuses an empty sub with no common_name at all", async () => {
    const { verify } = await createVerifier();
    await expect(verify({ sub: "" })).resolves.toEqual({
      outcome: "unauthenticated",
      reason: "claims_invalid",
    });
  });

  it("refuses a non-canonical sub that is not empty", async () => {
    const { verify } = await createVerifier();
    await expect(
      verify({ sub: "not-a-uuid", common_name: CLIENT_ID }),
    ).resolves.toEqual({
      outcome: "unauthenticated",
      reason: "claims_invalid",
    });
  });

  it("rejects an unbounded common_name before it is used as a lookup key", async () => {
    const { verify } = await createVerifier();
    await expect(
      verify({ sub: "", common_name: "a".repeat(129) }),
    ).resolves.toEqual({
      outcome: "unauthenticated",
      reason: "claims_invalid",
    });
  });
});

describe("service-token principal configuration", () => {
  it("resolves only exact declared client ids", () => {
    expect(PRINCIPALS.resolve(CLIENT_ID)).toBe(SERVICE_PRINCIPAL_ID);
    expect(PRINCIPALS.resolve(CLIENT_ID.toUpperCase())).toBeUndefined();
    expect(PRINCIPALS.resolve("__proto__")).toBeUndefined();
    expect(PRINCIPALS.resolve("constructor")).toBeUndefined();
  });

  it.each([
    ["a non-array", {}],
    [
      "an unknown key",
      [{ clientId: CLIENT_ID, principalId: SERVICE_PRINCIPAL_ID, role: "x" }],
    ],
    ["a missing principal", [{ clientId: CLIENT_ID }]],
    [
      "a non-canonical principal id",
      [{ clientId: CLIENT_ID, principalId: "nope" }],
    ],
    [
      "an unsafe client id",
      [{ clientId: "has space", principalId: SERVICE_PRINCIPAL_ID }],
    ],
    [
      "a duplicate client id",
      [
        { clientId: CLIENT_ID, principalId: SERVICE_PRINCIPAL_ID },
        { clientId: CLIENT_ID, principalId: HUMAN_PRINCIPAL_ID },
      ],
    ],
  ])("rejects %s", (_label, input) => {
    expect(() => createCloudflareAccessServiceTokenPrincipals(input)).toThrow();
  });
});
