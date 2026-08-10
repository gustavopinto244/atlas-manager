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
import { createInfrastructureDiagnosticsRuntime } from "../../src/infrastructure-diagnostics/composition/create-infrastructure-diagnostics-runtime.js";
import {
  CHECK_ID,
  CHECK_ORDER,
} from "../../src/infrastructure-diagnostics/domain/check-ids.js";
import type { ServerHealthSnapshot } from "../../src/server-health/domain/server-health-snapshot.js";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const ROUTE = "/admin/infrastructure/diagnostics";
const NOW = new Date("2026-08-01T14:00:00.000Z");

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

function responseErrorCode(response: { body: unknown }): unknown {
  const body = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { code?: unknown }).code;
}

type HostAdapterOverrides = Parameters<
  typeof createInfrastructureDiagnosticsRuntime
>[0]["hostAdapters"];

/**
 * Every adapter is injected. Nothing in this file spawns a subprocess or reads
 * real host state (ADR-032 section 11).
 */
function healthyHostAdapters(): HostAdapterOverrides {
  return {
    systemdUnitStateReader: {
      read: async () => ({
        outcome: "observed" as const,
        activeState: "active",
        subState: "running",
        unitFileState: "enabled",
      }),
    },
    tcpListenerReader: {
      read: async () => ({
        outcome: "observed" as const,
        listeners: [
          { port: 3000, binding: "loopback" as const, family: "ipv4" as const },
        ],
      }),
    },
    nginxConfigTestRunner: { run: async () => ({ outcome: "valid" as const }) },
  };
}

async function fixture(
  options: Readonly<{
    roles?: readonly string[];
    hostAdapters?: HostAdapterOverrides;
  }> = {},
) {
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
  const clock = { now: vi.fn(() => NOW) };
  const history = createEventHistory();
  const roleAssignmentReader = new InMemoryAdministrativeRoleAssignmentReader({
    assignments: [
      { principalId: PRINCIPAL_ID, roles: options.roles ?? ["administrator"] },
    ],
  });
  const authentication = createCloudflareAccessAdministrativeAuthentication({
    configuration,
    clock,
    overrides: {
      fetch: async () =>
        new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 }),
    },
  });
  const diagnostics = createInfrastructureDiagnosticsRuntime({
    clock,
    expectedListener: { port: 3000, binding: "loopback" },
    serverHealthReader: { execute: async () => health() },
    powerPostureReader: {
      execute: () => ({ backend: "mock", effects: "linux_helper" }),
    },
    hostAdapters: options.hostAdapters ?? healthyHostAdapters()!,
  });
  const admission = new FixedAdministrativeRequestAdmission(clock);
  const createProtected = (reader: CloudflareAccessAssertionReader) =>
    createProtectedAdministration({
      accessControl: createAdministrativeAccessControl({
        authenticator:
          authentication.createAuthenticationProviderForRequest(reader),
        roleAssignmentReader,
      }),
      eventHistory: history,
      clock,
      infrastructureDiagnosticsReader: diagnostics.getInfrastructureDiagnostics,
    });
  const app = createApp({
    logger: { error: vi.fn() },
    getServerHealth: { execute: vi.fn(async () => health()) },
    administrativePublicOrigin: parseAdministrativePublicOrigin(
      "https://atlas.example.com",
    ),
    administrativeInfrastructureDiagnostics: {
      admission,
      createProtectedAdministration: (reader) => ({
        getInfrastructureDiagnostics:
          createProtected(reader).getInfrastructureDiagnostics,
      }),
    },
  });
  return { app, token };
}

type ReportBody = Readonly<{
  generatedAt: unknown;
  overallStatus: unknown;
  checks: readonly Readonly<{ id: string; status: string }>[];
}>;

function report(response: { body: unknown }): ReportBody {
  return response.body as ReportBody;
}

function checkIds(response: { body: unknown }): readonly string[] {
  return report(response).checks.map((check) => check.id);
}

function statusOf(response: { body: unknown }, id: string): string | undefined {
  return report(response).checks.find((check) => check.id === id)?.status;
}

function get(app: Awaited<ReturnType<typeof fixture>>["app"], token?: string) {
  const builder = request(app).get(ROUTE).set("host", "atlas.example.com");
  if (token !== undefined) builder.set("Cf-Access-Jwt-Assertion", token);
  return builder;
}

describe("administrative infrastructure diagnostics route", () => {
  it("returns 200 with the full ordered report for an authorized administrator", async () => {
    const { app, token } = await fixture();
    const response = await get(app, token);
    expect(response.status).toBe(200);
    expect(report(response).overallStatus).toBe("ok");
    expect(checkIds(response)).toEqual([...CHECK_ORDER]);
    expect(typeof report(response).generatedAt).toBe("string");
  });

  it("grants an auditor the same read", async () => {
    const { app, token } = await fixture({ roles: ["auditor"] });
    expect((await get(app, token)).status).toBe(200);
  });

  // The HTTP half of the partial-failure obligation (ADR-032 section 5.2).
  // A failing check must never become a failing response, or the checks that
  // did succeed are lost precisely when the operator needs them most.
  it("still answers 200, with every other check present, when one adapter fails", async () => {
    const { app, token } = await fixture({
      hostAdapters: {
        ...healthyHostAdapters(),
        systemdUnitStateReader: {
          read: async () => {
            throw new Error("systemd exploded");
          },
        },
      },
    });
    const response = await get(app, token);
    expect(response.status).toBe(200);
    expect(checkIds(response)).toEqual([...CHECK_ORDER]);
    expect(statusOf(response, CHECK_ID.atlasService)).toBe("unavailable");
    expect(statusOf(response, CHECK_ID.nginxConfig)).toBe("ok");
    expect(statusOf(response, CHECK_ID.listenerAtlas)).toBe("ok");
  });

  it("answers 200 even when the overall status is down", async () => {
    const { app, token } = await fixture({
      hostAdapters: {
        ...healthyHostAdapters(),
        systemdUnitStateReader: {
          read: async () => ({
            outcome: "observed" as const,
            activeState: "failed",
            subState: "failed",
            unitFileState: "enabled",
          }),
        },
      },
    });
    const response = await get(app, token);
    expect(response.status).toBe(200);
    expect(report(response).overallStatus).toBe("down");
  });

  it("orders checks identically across repeated fetches with differing timings", async () => {
    let call = 0;
    const { app, token } = await fixture({
      hostAdapters: {
        ...healthyHostAdapters(),
        systemdUnitStateReader: {
          read: async () => {
            await new Promise((resolve) => setTimeout(resolve, call++ % 3));
            return {
              outcome: "observed" as const,
              activeState: "active",
              subState: "running",
              unitFileState: "enabled",
            };
          },
        },
      },
    });
    const first = await get(app, token);
    const second = await get(app, token);
    expect(checkIds(first)).toEqual(checkIds(second));
  });

  it("fails closed without an Access assertion", async () => {
    const { app } = await fixture();
    const response = await get(app);
    expect(response.status).toBe(401);
    expect(responseErrorCode(response)).toBe(
      "administrative_authentication_required",
    );
  });

  it("refuses a role that lacks infrastructure.diagnostics.read", async () => {
    const { app, token } = await fixture({ roles: ["service_operator"] });
    const response = await get(app, token);
    expect(response.status).toBe(403);
  });

  it("never leaks a credential into the diagnostic payload", async () => {
    const { app, token } = await fixture();
    const serialized = JSON.stringify(report(await get(app, token)));
    expect(serialized).not.toContain(token);
    for (const forbidden of ["jwt", "Cf-Access", "password", "secret", "token"])
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it("rejects a mutating method rather than treating it as a read", async () => {
    const { app, token } = await fixture();
    const response = await request(app)
      .post(ROUTE)
      .set("host", "atlas.example.com")
      .set("Cf-Access-Jwt-Assertion", token);
    expect([404, 405]).toContain(response.status);
  });
});
