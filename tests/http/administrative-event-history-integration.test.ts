import { generateKeyPairSync } from "node:crypto";

import { exportJWK, SignJWT } from "jose";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAdministrativeAccessControl } from "../../src/access-control/composition/create-administrative-access-control.js";
import { createCloudflareAccessAdministrativeAuthentication } from "../../src/access-control/composition/create-cloudflare-access-administrative-authentication.js";
import { createProtectedAdministration } from "../../src/access-control/composition/create-protected-administration.js";
import { createCloudflareAccessConfiguration } from "../../src/access-control/domain/cloudflare-access-configuration.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "../../src/access-control/infrastructure/in-memory-administrative-role-assignment-reader.js";
import { createEventHistory } from "../../src/event-history/composition/create-event-history.js";
import type { AdministrativeEventHistoryPage } from "../../src/event-history/domain/administrative-event-history-page.js";
import { createPowerManagement } from "../../src/power-management/composition/create-power-management.js";
import { FixedAdministrativeRequestAdmission } from "../../src/http/administrative-request-admission.js";
import {
  ADMINISTRATIVE_EVENT_HISTORY_ROUTE,
  type AdministrativeEventHistoryRouteDependencies,
} from "../../src/http/administrative-event-history-route.js";
import { createApp } from "../../src/http/create-app.js";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-31T12:00:00.000Z");

describe("protected administrative event-history integration", () => {
  it("verifies Cloudflare identity, authorizes auditor, audits, and queries shared history", async () => {
    const fixture = await createIdentityFixture();
    const dependencies = createRouteDependencies(fixture);
    const response = await request(createApp(dependencies.app))
      .get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE)
      .set("Cf-Access-Jwt-Assertion", fixture.token);

    expect(response.status).toBe(200);
    const responseBody = response.body as {
      events: readonly Record<string, unknown>[];
    };
    expect(responseBody.events).toHaveLength(1);
    expect(responseBody.events[0]).toMatchObject({
      operation: "authorize_administrative_operation",
      status: "succeeded",
      source: {
        actorId: `administrator:${PRINCIPAL_ID}`,
      },
      details: {
        requestedOperation: "read_administrative_event_history",
        permission: "event_history.read",
        decision: "allowed",
      },
    });
    expect(dependencies.query).toHaveBeenCalledOnce();
    expect(dependencies.fetch.calls).toBe(1);
  });

  it("uses one safe 401 response for missing and invalid assertions", async () => {
    const fixture = await createIdentityFixture();
    const dependencies = createRouteDependencies(fixture);
    const app = createApp(dependencies.app);
    const missing = await request(app).get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE);
    const invalid = await request(app)
      .get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE)
      .set("Cf-Access-Jwt-Assertion", "invalid");

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(missing.body).toEqual(invalid.body);
    expect(dependencies.query).not.toHaveBeenCalled();
  });

  it("denies a power operator without bypassing the protected facade", async () => {
    const fixture = await createIdentityFixture(["power_operator"]);
    const dependencies = createRouteDependencies(fixture);
    const response = await request(createApp(dependencies.app))
      .get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE)
      .set("Cf-Access-Jwt-Assertion", fixture.token);

    expect(response.status).toBe(403);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe("administrative_authorization_denied");
    expect(dependencies.query).not.toHaveBeenCalled();
    const events = await dependencies.historyEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.details).toMatchObject({
      decision: "denied",
      reasonCode: "permission_denied",
    });
  });
});

async function createIdentityFixture(roles: string[] = ["auditor"]) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const configuration = createCloudflareAccessConfiguration({
    teamName: "atlas",
    audience: "atlas-admin",
  });
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    alg: "RS256",
    kid: "K1",
    use: "sig",
  };
  const token = await new SignJWT({
    aud: configuration.audience,
    exp: Math.floor(NOW.getTime() / 1_000) + 300,
    iat: Math.floor(NOW.getTime() / 1_000),
    iss: configuration.issuer,
    sub: PRINCIPAL_ID,
    type: "app",
  })
    .setProtectedHeader({ alg: "RS256", kid: "K1", typ: "JWT" })
    .sign(privateKey);
  return { configuration, publicJwk, token, roles };
}

function createRouteDependencies(
  fixture: Awaited<ReturnType<typeof createIdentityFixture>>,
) {
  const clock = { now: vi.fn(() => NOW) };
  const history = createEventHistory();
  const query = vi.fn();
  const roleAssignmentReader = new InMemoryAdministrativeRoleAssignmentReader({
    assignments: [{ principalId: PRINCIPAL_ID, roles: fixture.roles }],
  });
  const fetchWithCount = Object.assign(
    async (input: string, init: Readonly<Record<string, unknown>>) => {
      void input;
      void init;
      fetchWithCount.calls += 1;
      return new Response(JSON.stringify({ keys: [fixture.publicJwk] }), {
        status: 200,
      });
    },
    { calls: 0 },
  );
  const authentication = createCloudflareAccessAdministrativeAuthentication({
    configuration: fixture.configuration,
    clock,
    overrides: { fetch: fetchWithCount },
  });
  const powerManagement = createPowerManagement({
    clock,
    administrativeEventHistoryCapabilities: history,
  });
  const admission = new FixedAdministrativeRequestAdmission(clock, {
    maximumConcurrent: 4,
  });
  const routeDependencies: AdministrativeEventHistoryRouteDependencies = {
    admission,
    createProtectedEventHistoryQuery: (reader) => {
      const accessControl = createAdministrativeAccessControl({
        authenticator:
          authentication.createAuthenticationProviderForRequest(reader),
        roleAssignmentReader,
      });
      const protectedAdministration = createProtectedAdministration({
        accessControl,
        powerManagement,
        eventHistory: history,
        clock,
      });
      return {
        execute: async (input: unknown) => {
          const result =
            await protectedAdministration.getAdministrativeEventHistory.execute(
              input,
            );
          query(input);
          return result as AdministrativeEventHistoryPage;
        },
      };
    },
  };
  return {
    app: {
      logger: { error: vi.fn() },
      getServerHealth: { execute: vi.fn() },
      administrativeEventHistory: routeDependencies,
    },
    query,
    fetch: fetchWithCount,
    historyEvents: async () =>
      (await history.getAdministrativeEventHistory.execute()).events,
  };
}
