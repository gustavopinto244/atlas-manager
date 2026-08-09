import { generateKeyPairSync } from "node:crypto";
import { exportJWK, SignJWT } from "jose";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAdministrativeAccessControl } from "../../src/access-control/composition/create-administrative-access-control.js";
import { createCloudflareAccessAdministrativeAuthentication } from "../../src/access-control/composition/create-cloudflare-access-administrative-authentication.js";
import { createProtectedAdministration } from "../../src/access-control/composition/create-protected-administration.js";
import type { CloudflareAccessAssertionReader } from "../../src/access-control/application/ports/cloudflare-access-assertion-reader.js";
import { createCloudflareAccessConfiguration } from "../../src/access-control/domain/cloudflare-access-configuration.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "../../src/access-control/infrastructure/in-memory-administrative-role-assignment-reader.js";
import { createEventHistory } from "../../src/event-history/composition/create-event-history.js";
import { FixedAdministrativeRequestAdmission } from "../../src/http/administrative-request-admission.js";
import { parseAdministrativePublicOrigin } from "../../src/http/administrative-public-origin.js";
import { createApp } from "../../src/http/create-app.js";
import { createPowerManagement } from "../../src/power-management/composition/create-power-management.js";
import { createServiceManagement } from "../../src/service-management/composition/create-service-management.js";
import type { ServerHealthSnapshot } from "../../src/server-health/domain/server-health-snapshot.js";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const UNKNOWN_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-01T14:00:00.000Z");

function responseErrorCode(response: { body: unknown }): unknown {
  const body = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { code?: unknown }).code;
}

function health(): ServerHealthSnapshot {
  return {
    capturedAtIso: NOW.toISOString(),
    uptimeSeconds: 1,
    totalMemoryBytes: 100,
    freeMemoryBytes: 50,
    usedMemoryBytes: 50,
    memoryUsagePercent: 50,
    cpuUsagePercent: 1,
    cpuTemperatureCelsius: null,
    cpuLoadAverage1Minute: 0,
    cpuLoadAverage5Minutes: 0,
    cpuLoadAverage15Minutes: 0,
    diskTotalBytes: 100,
    diskAvailableBytes: 50,
    diskUsedBytes: 50,
    diskUsagePercent: 50,
  };
}

async function fixture(roles: readonly string[] = ["administrator"]) {
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
  const tokenFor = async (principalId: string) =>
    new SignJWT({
      aud: configuration.audience,
      exp: Math.floor(NOW.getTime() / 1_000) + 300,
      iat: Math.floor(NOW.getTime() / 1_000),
      iss: configuration.issuer,
      sub: principalId,
      type: "app",
    })
      .setProtectedHeader({ alg: "RS256", kid: "K1", typ: "JWT" })
      .sign(privateKey);
  const clock = { now: vi.fn(() => NOW) };
  const history = createEventHistory();
  const roleAssignmentReader = new InMemoryAdministrativeRoleAssignmentReader({
    assignments: [{ principalId: PRINCIPAL_ID, roles }],
  });
  const authentication = createCloudflareAccessAdministrativeAuthentication({
    configuration,
    clock,
    overrides: {
      fetch: async () =>
        new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 }),
    },
  });
  const serviceManagement = createServiceManagement(
    {
      REGISTERED_SERVICES_JSON: JSON.stringify([
        {
          id: "mock-service",
          displayName: "Mock Service",
          managementAdapter: "mock",
          externalResourceId: "mock-target",
          supportedOperations: ["readStatus"],
          availabilityPolicy: { mode: "manual" },
        },
      ]),
    },
    {
      mockStatusConfiguration: [
        { externalResourceId: "mock-target", state: "running" },
      ],
    },
  );
  const powerManagement = createPowerManagement({
    clock,
    administrativeEventHistoryCapabilities: history,
  });
  const admission = new FixedAdministrativeRequestAdmission(clock);
  const createProtected = (reader: CloudflareAccessAssertionReader) =>
    createProtectedAdministration({
      accessControl: createAdministrativeAccessControl({
        authenticator:
          authentication.createAuthenticationProviderForRequest(reader),
        roleAssignmentReader,
      }),
      serviceManagement,
      powerManagement,
      eventHistory: history,
      clock,
    });
  const app = createApp({
    logger: { error: vi.fn() },
    getServerHealth: { execute: vi.fn(async () => health()) },
    administrativePublicOrigin: parseAdministrativePublicOrigin(
      "https://atlas.example.com",
    ),
    administrativeDashboard: {
      admission,
      createProtectedAdministration: (reader) => ({
        getAdministrativeDashboard:
          createProtected(reader).getAdministrativeDashboard,
      }),
    },
    administrativeOverview: {
      admission,
      createProtectedAdministration: (reader) => ({
        getOperationsOverview: createProtected(reader).getOperationsOverview,
      }),
      getServerHealth: { execute: vi.fn(async () => health()) },
      applicationVersion: "1.0.0-rc.10",
    },
  });
  return { app, tokenFor };
}

describe("administrative dashboard authentication integration", () => {
  it("fails closed for shell, overview, and assets without or with invalid Access", async () => {
    const value = await fixture();
    const invalid = "invalid";
    for (const assertion of [undefined, invalid]) {
      for (const path of ["/", "/admin/overview", "/assets/app.js"]) {
        const requestBuilder = request(value.app)
          .get(path)
          .set("host", "atlas.example.com");
        if (assertion !== undefined)
          requestBuilder.set("Cf-Access-Jwt-Assertion", assertion);
        const response = await requestBuilder;
        expect(response.status, `${path}:${assertion ?? "missing"}`).toBe(401);
        expect(responseErrorCode(response)).toBe(
          "administrative_authentication_required",
        );
      }
    }
  });

  it("serves the dashboard, overview, and assets for an authorized principal", async () => {
    const value = await fixture();
    const token = await value.tokenFor(PRINCIPAL_ID);
    for (const path of ["/", "/admin/overview", "/assets/app.js"]) {
      const response = await request(value.app)
        .get(path)
        .set("host", "atlas.example.com")
        .set("Cf-Access-Jwt-Assertion", token);
      expect(response.status, path).toBe(200);
    }
  });

  it("accepts only the authenticated Cloudflare Access return navigation as cross-site", async () => {
    const value = await fixture();
    const token = await value.tokenFor(PRINCIPAL_ID);
    const dashboardReturn = await request(value.app)
      .get("/")
      .set("host", "atlas.example.com")
      .set("Cf-Access-Jwt-Assertion", token)
      .set("Sec-Fetch-Site", "cross-site")
      .set("Sec-Fetch-Mode", "navigate")
      .set("Sec-Fetch-Dest", "document");
    expect(dashboardReturn.status).toBe(200);

    const unauthenticatedReturn = await request(value.app)
      .get("/")
      .set("host", "atlas.example.com")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Sec-Fetch-Mode", "navigate")
      .set("Sec-Fetch-Dest", "document");
    expect(unauthenticatedReturn.status).toBe(401);
    expect(responseErrorCode(unauthenticatedReturn)).toBe(
      "administrative_authentication_required",
    );

    const crossSiteApi = await request(value.app)
      .get("/admin/overview")
      .set("host", "atlas.example.com")
      .set("Cf-Access-Jwt-Assertion", token)
      .set("Sec-Fetch-Site", "cross-site")
      .set("Sec-Fetch-Mode", "cors")
      .set("Sec-Fetch-Dest", "empty");
    expect(crossSiteApi.status).toBe(403);
    expect(responseErrorCode(crossSiteApi)).toBe(
      "administrative_browser_context_rejected",
    );
  });

  it("denies a valid assertion for an unknown principal", async () => {
    const value = await fixture();
    const token = await value.tokenFor(UNKNOWN_PRINCIPAL_ID);
    const response = await request(value.app)
      .get("/admin/overview")
      .set("host", "atlas.example.com")
      .set("Cf-Access-Jwt-Assertion", token);

    expect(response.status).toBe(403);
    expect(responseErrorCode(response)).toBe(
      "administrative_authorization_denied",
    );
  });
});
