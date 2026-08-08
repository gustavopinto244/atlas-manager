import { generateKeyPairSync } from "node:crypto";

import { exportJWK, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import { createCloudflareAccessConfiguration } from "../../src/access-control/domain/cloudflare-access-configuration.js";
import { createCloudflareAccessJwtAssertion } from "../../src/access-control/domain/cloudflare-access-jwt-assertion.js";
import {
  CloudflareAccessJwksProvider,
  type CloudflareAccessJwksFetch,
} from "../../src/access-control/infrastructure/cloudflare-access-jwks-provider.js";
import { CloudflareAccessJwtVerifierAdapter } from "../../src/access-control/infrastructure/cloudflare-access-jwt-verifier.js";
import { AuthenticateAdministrativeRequest } from "../../src/access-control/application/authenticate-administrative-request.js";
import { createAdministrativeAccessControl } from "../../src/access-control/composition/create-administrative-access-control.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "../../src/access-control/infrastructure/in-memory-administrative-role-assignment-reader.js";
import { createCloudflareAccessAssertionReaderFromHeaders } from "../../src/http/cloudflare-access-assertion-reader.js";
import { createCloudflareAccessAdministrativeAuthentication } from "../../src/access-control/composition/create-cloudflare-access-administrative-authentication.js";
import { parseEnvironment } from "../../src/config/environment.js";

const PRINCIPAL_ID = "caf45cc3-4312-5d41-8603-cc0102346a1f";
const NOW = new Date("2026-07-31T12:00:00.000Z");

describe("Cloudflare Access configuration", () => {
  it("derives the fixed issuer without accepting a URL", () => {
    expect(
      createCloudflareAccessConfiguration({
        teamName: "atlas-home",
        audience: "application-audience",
      }),
    ).toEqual({
      teamName: "atlas-home",
      issuer: "https://atlas-home.cloudflareaccess.com",
      audience: "application-audience",
    });
  });

  it.each([
    "https://atlas.cloudflareaccess.com",
    "atlas.cloudflareaccess.com",
    "ATLAS",
    "atlas/",
    "atlas:443",
    " atlas",
    "atlas ",
  ])("rejects unsafe team name %s", (teamName) => {
    expect(() =>
      createCloudflareAccessConfiguration({ teamName, audience: "aud" }),
    ).toThrow();
  });

  it.each(["", "aud value", '"aud"', "aud,other", "aud\nother"])(
    "rejects unsafe audience %s",
    (audience) => {
      expect(() =>
        createCloudflareAccessConfiguration({ teamName: "atlas", audience }),
      ).toThrow();
    },
  );

  it("requires paired environment values", () => {
    expect(() =>
      parseEnvironment({ CLOUDFLARE_ACCESS_TEAM_NAME: "atlas" }),
    ).toThrow();
    expect(
      parseEnvironment({
        CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
        CLOUDFLARE_ACCESS_AUDIENCE: "aud",
      }).cloudflareAccess,
    ).toEqual({
      teamName: "atlas",
      issuer: "https://atlas.cloudflareaccess.com",
      audience: "aud",
    });
  });
});

describe("Cloudflare Access assertion reader", () => {
  it("accepts the header case-insensitively and reads it once", () => {
    const reader = createCloudflareAccessAssertionReaderFromHeaders({
      "CF-ACCESS-JWT-ASSERTION": "a.b.c",
    });
    expect(reader.read()).toEqual({ outcome: "present", assertion: "a.b.c" });
    expect(reader.read()).toEqual({ outcome: "present", assertion: "a.b.c" });
  });

  it.each([
    {},
    { "Cf-Access-Jwt-Assertion": "" },
    { "Cf-Access-Jwt-Assertion": " a.b.c" },
    { "Cf-Access-Jwt-Assertion": "a.b.c " },
    { "Cf-Access-Jwt-Assertion": "a.b" },
    { "Cf-Access-Jwt-Assertion": "a.b.c,d.e.f" },
    { "Cf-Access-Jwt-Assertion": ["a.b.c"] },
    { "Cf-Access-Jwt-Assertion": 42 },
    { Cookie: "CF_Authorization=a.b.c" },
    { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
  ])("maps unsafe request-shaped headers to a safe result", (headers) => {
    const result =
      createCloudflareAccessAssertionReaderFromHeaders(headers).read();
    expect(result.outcome).toBe(
      Object.keys(headers).some(
        (key) => key.toLowerCase() === "cf-access-jwt-assertion",
      )
        ? "invalid"
        : "absent",
    );
  });

  it("rejects duplicate case variants and values over the byte limit", () => {
    expect(
      createCloudflareAccessAssertionReaderFromHeaders({
        "Cf-Access-Jwt-Assertion": "a.b.c",
        "cf-access-jwt-assertion": "a.b.c",
      }).read(),
    ).toEqual({ outcome: "invalid" });
    const oversized = `a.${"a".repeat(16_383)}.c`;
    expect(
      createCloudflareAccessAssertionReaderFromHeaders({
        "Cf-Access-Jwt-Assertion": oversized,
      }).read(),
    ).toEqual({ outcome: "invalid" });
  });
});

describe("Cloudflare Access JWT verification", () => {
  it("verifies a signed application token and creates only the principal", async () => {
    const fixture = await createFixture();
    const fetch = createJwksFetch(fixture.publicJwk);
    const provider = new CloudflareAccessJwksProvider(fixture.configuration, {
      fetch,
    });
    const verifier = new CloudflareAccessJwtVerifierAdapter(
      fixture.configuration,
      provider,
    );
    const result = await verifier.verify(
      createCloudflareAccessJwtAssertion(await fixture.token()),
      NOW,
    );
    expect(result).toEqual({
      outcome: "authenticated",
      principal: { principalId: PRINCIPAL_ID },
    });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]).toBe(
      "https://atlas.cloudflareaccess.com/cdn-cgi/access/certs",
    );
    expect(fetch.lastInit).toMatchObject({
      method: "GET",
      redirect: "error",
      credentials: "omit",
    });
  });

  it("rejects a correctly signed service token without a subject", async () => {
    const fixture = await createFixture();
    const fetch = createJwksFetch(fixture.publicJwk);
    const verifier = new CloudflareAccessJwtVerifierAdapter(
      fixture.configuration,
      new CloudflareAccessJwksProvider(fixture.configuration, { fetch }),
    );
    const token = await fixture.token({ sub: "" });
    await expect(
      verifier.verify(createCloudflareAccessJwtAssertion(token), NOW),
    ).resolves.toEqual({
      outcome: "unauthenticated",
      reason: "credentials_invalid",
    });
    expect(fetch.calls).toHaveLength(1);
  });

  it("refreshes once when a rotated key is referenced", async () => {
    const first = await createFixture("K1");
    const second = await createFixture("K2");
    let fetchCount = 0;
    const fetch: CloudflareAccessJwksFetch = async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          keys:
            fetchCount === 1
              ? [first.publicJwk]
              : [first.publicJwk, second.publicJwk],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const provider = new CloudflareAccessJwksProvider(first.configuration, {
      fetch,
    });
    const verifier = new CloudflareAccessJwtVerifierAdapter(
      first.configuration,
      provider,
    );
    await verifier.verify(
      createCloudflareAccessJwtAssertion(await first.token()),
      NOW,
    );
    const token = await second.token();
    const result = await verifier.verify(
      createCloudflareAccessJwtAssertion(token),
      NOW,
    );
    expect(fetchCount).toBe(2);
    expect(result).toEqual({
      outcome: "authenticated",
      principal: { principalId: PRINCIPAL_ID },
    });
    expect(fetchCount).toBe(2);
  });

  it("maps a required-key outage to provider unavailable", async () => {
    const fixture = await createFixture();
    const fetch: CloudflareAccessJwksFetch = vi.fn(async () => {
      throw new Error("network detail must stay private");
    });
    const verifier = new CloudflareAccessJwtVerifierAdapter(
      fixture.configuration,
      new CloudflareAccessJwksProvider(fixture.configuration, { fetch }),
    );
    await expect(
      verifier.verify(
        createCloudflareAccessJwtAssertion(await fixture.token()),
        NOW,
      ),
    ).resolves.toEqual({
      outcome: "unavailable",
      reason: "identity_provider_unavailable",
    });
  });

  it("uses a cached key without another network request", async () => {
    const fixture = await createFixture();
    const fetch = createJwksFetch(fixture.publicJwk);
    const provider = new CloudflareAccessJwksProvider(fixture.configuration, {
      fetch,
    });
    const verifier = new CloudflareAccessJwtVerifierAdapter(
      fixture.configuration,
      provider,
    );
    const assertion = createCloudflareAccessJwtAssertion(await fixture.token());
    await verifier.verify(assertion, NOW);
    await verifier.verify(assertion, new Date(NOW.getTime() + 1_000));
    expect(fetch.calls).toHaveLength(1);
  });

  it("flows a verified subject through the existing access-control port", async () => {
    const fixture = await createFixture();
    const fetch = createJwksFetch(fixture.publicJwk);
    const authentication = createCloudflareAccessAdministrativeAuthentication({
      configuration: fixture.configuration,
      clock: { now: vi.fn(() => NOW) },
      overrides: { fetch },
    });
    const provider = authentication.createAuthenticationProviderForRequest(
      createCloudflareAccessAssertionReaderFromHeaders({
        "Cf-Access-Jwt-Assertion": await fixture.token(),
      }),
    );
    const accessControl = createAdministrativeAccessControl({
      authenticator: provider,
      roleAssignmentReader: new InMemoryAdministrativeRoleAssignmentReader({
        assignments: [{ principalId: PRINCIPAL_ID, roles: ["administrator"] }],
      }),
    });
    const authenticated = await new AuthenticateAdministrativeRequest(
      provider,
    ).execute();
    expect(authenticated).toEqual({
      outcome: "authenticated",
      principal: { principalId: PRINCIPAL_ID },
    });
    await expect(
      accessControl.authorizeAdministrativeOperation.execute({
        principal:
          authenticated.outcome === "authenticated"
            ? authenticated.principal
            : undefined,
        operation: "schedule_wake_alarm",
        evaluatedAt: "2026-07-31T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "allowed" });
  });
});

describe("Cloudflare Access authentication composition", () => {
  it("preserves deny-all behavior without configuration and does no request work", async () => {
    const reader = {
      read: vi.fn(() => ({
        outcome: "present" as const,
        assertion: "a.b.c" as never,
      })),
    };
    const clock = { now: vi.fn(() => NOW) };
    const capabilities = createCloudflareAccessAdministrativeAuthentication({
      clock,
    });
    const result = await capabilities
      .createAuthenticationProviderForRequest(reader)
      .authenticate();
    expect(result).toEqual({
      outcome: "unauthenticated",
      reason: "credentials_absent",
    });
    expect(reader.read).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
    await expect(capabilities.checkIdentityProviderReadiness()).resolves.toBe(
      "unavailable",
    );
  });

  it("maps the request-scoped provider through the existing result contract", async () => {
    const fixture = await createFixture();
    const fetch = createJwksFetch(fixture.publicJwk);
    const clock = { now: vi.fn(() => NOW) };
    const capabilities = createCloudflareAccessAdministrativeAuthentication({
      configuration: fixture.configuration,
      clock,
      overrides: { fetch },
    });
    const reader = createCloudflareAccessAssertionReaderFromHeaders({
      "Cf-Access-Jwt-Assertion": await fixture.token(),
    });
    await expect(
      capabilities
        .createAuthenticationProviderForRequest(reader)
        .authenticate(),
    ).resolves.toEqual({
      outcome: "authenticated",
      principal: { principalId: PRINCIPAL_ID },
    });
    expect(clock.now).toHaveBeenCalledTimes(1);
  });

  it("reports a usable cached-key readiness state without another refresh", async () => {
    const fixture = await createFixture();
    const fetch = createJwksFetch(fixture.publicJwk);
    const capabilities = createCloudflareAccessAdministrativeAuthentication({
      configuration: fixture.configuration,
      clock: { now: vi.fn(() => NOW) },
      overrides: { fetch },
    });
    await expect(
      capabilities.readIdentityProviderReadiness(),
    ).resolves.toMatchObject({
      outcome: "ready",
      cachedKeyCount: 1,
      jwksReachable: true,
    });
    await expect(
      capabilities.readIdentityProviderReadiness(),
    ).resolves.toMatchObject({
      outcome: "ready_with_cached_keys",
      cachedKeyCount: 1,
      jwksReachable: false,
    });
    expect(fetch.calls).toHaveLength(1);
  });
});

type Fixture = {
  configuration: ReturnType<typeof createCloudflareAccessConfiguration>;
  publicJwk: Record<string, unknown>;
  token: (overrides?: { sub?: string }) => Promise<string>;
};

async function createFixture(kid = "K1"): Promise<Fixture> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    alg: "RS256",
    kid,
    use: "sig",
  };
  const configuration = createCloudflareAccessConfiguration({
    teamName: "atlas",
    audience: "atlas-admin",
  });
  return {
    configuration,
    publicJwk,
    token: async (overrides = {}) =>
      new SignJWT({
        aud: configuration.audience,
        exp: Math.floor(NOW.getTime() / 1_000) + 300,
        iat: Math.floor(NOW.getTime() / 1_000),
        iss: configuration.issuer,
        sub: overrides.sub ?? PRINCIPAL_ID,
        type: "app",
      })
        .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
        .sign(privateKey),
  };
}

function createJwksFetch(publicJwk: Record<string, unknown>) {
  const calls: string[] = [];
  let lastInit: unknown;
  const fetch: CloudflareAccessJwksFetch & {
    calls: string[];
    lastInit: unknown;
  } = Object.assign(
    async (input: string, init: Readonly<Record<string, unknown>>) => {
      calls.push(input);
      lastInit = init;
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
      });
    },
    { calls },
  ) as unknown as CloudflareAccessJwksFetch & {
    calls: string[];
    lastInit: unknown;
  };
  Object.defineProperty(fetch, "lastInit", {
    configurable: false,
    enumerable: true,
    get: () => lastInit,
  });
  return fetch;
}
