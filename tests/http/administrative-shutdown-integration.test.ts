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
import { FixedAdministrativeRequestAdmission } from "../../src/http/administrative-request-admission.js";
import { FixedAdministrativePowerOperationGate } from "../../src/http/administrative-power-operation-gate.js";
import {
  ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE,
  ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE,
  type AdministrativeShutdownRouteDependencies,
} from "../../src/http/administrative-shutdown-route.js";
import { createApp } from "../../src/http/create-app.js";
import { createPowerManagement } from "../../src/power-management/composition/create-power-management.js";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-01T14:00:00.000Z");
const OCCURRENCE = {
  operation: "shutdown" as const,
  scheduledFor: NOW.toISOString(),
  wakeScheduledFor: "2026-08-02T09:00:00.000Z",
};

describe("protected shutdown workflow", () => {
  it("prepares separately, executes with fresh confirmation, and deduplicates replay", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.app);
    const preparation = await authenticated(
      app,
      ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE,
      fixture.token,
      "confirm_shutdown_preparation",
    );
    const execution = await authenticated(
      app,
      ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE,
      fixture.token,
      "confirm_shutdown_execution",
    );
    const replay = await authenticated(
      app,
      ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE,
      fixture.token,
      "confirm_shutdown_execution",
    );

    expect(preparation.status).toBe(200);
    expect((preparation.body as { outcome: string }).outcome).toBe(
      "not_required",
    );
    expect(execution.status).toBe(200);
    expect((execution.body as { outcome: string }).outcome).toBe("executed");
    expect(replay.status).toBe(200);
    expect((replay.body as { outcome: string }).outcome).toBe("duplicate");
    expect(fixture.wakeSchedule).toHaveBeenCalledOnce();
    expect(fixture.shutdownRequest).toHaveBeenCalledOnce();

    const events = await fixture.events();
    expect(events.map((event) => [event.operation, event.status])).toEqual([
      ["authorize_administrative_operation", "succeeded"],
      ["prepare_machine_shutdown_occurrence", "started"],
      ["prepare_machine_shutdown_occurrence", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
      ["execute_machine_shutdown_occurrence", "started"],
      ["execute_machine_shutdown_occurrence", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
      ["execute_machine_shutdown_occurrence", "started"],
      ["execute_machine_shutdown_occurrence", "rejected"],
    ]);
    expect(JSON.stringify(events)).not.toContain("confirm_shutdown");
  });
});

async function createFixture() {
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
    assignments: [{ principalId: PRINCIPAL_ID, roles: ["power_operator"] }],
  });
  const authentication = createCloudflareAccessAdministrativeAuthentication({
    configuration,
    clock,
    overrides: {
      fetch: async () =>
        new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 }),
    },
  });
  const wakeSchedule = vi.fn(
    async (requestedAt: string, scheduledFor: string) => ({
      operation: "schedule" as const,
      requestedAt,
      outcome: "scheduled" as const,
      before: { state: "not_scheduled" as const },
      after: { state: "scheduled" as const, scheduledFor },
    }),
  );
  const shutdownRequest = vi.fn(async (requestedAt: string) => ({
    operation: "shutdown" as const,
    requestedAt,
    outcome: "simulated" as const,
  }));
  const power = createPowerManagement({
    clock,
    administrativeEventHistoryCapabilities: history,
    wakeAlarmController: { schedule: wakeSchedule, cancel: vi.fn() },
    machineShutdownController: { requestShutdown: shutdownRequest },
    machineShutdownServiceReadinessReader: {
      read: vi.fn(async () => ({
        state: "ready" as const,
        blockers: [] as const,
      })),
    },
    machineShutdownActiveTaskReadinessReader: {
      read: vi.fn(async () => ({
        area: "active_tasks" as const,
        state: "ready" as const,
      })),
    },
    machineShutdownBackupReadinessReader: {
      read: vi.fn(async () => ({
        area: "backups" as const,
        state: "ready" as const,
      })),
    },
    machineShutdownFilesystemReadinessReader: {
      read: vi.fn(async () => ({
        area: "filesystem" as const,
        state: "ready" as const,
      })),
    },
  });
  const dependencies: AdministrativeShutdownRouteDependencies = {
    admission: new FixedAdministrativeRequestAdmission(clock),
    powerOperationGate: new FixedAdministrativePowerOperationGate(),
    createProtectedAdministration: (reader, confirmationReader) => {
      const accessControl = createAdministrativeAccessControl({
        authenticator:
          authentication.createAuthenticationProviderForRequest(reader),
        roleAssignmentReader,
      });
      return createProtectedAdministration({
        accessControl,
        powerManagement: power,
        eventHistory: history,
        clock,
        machineShutdownConfirmationReader: confirmationReader,
      });
    },
  };
  return {
    token,
    app: {
      logger: { error: vi.fn() },
      getServerHealth: { execute: vi.fn() },
      administrativeShutdown: dependencies,
    },
    wakeSchedule,
    shutdownRequest,
    events: async () =>
      (await history.getAdministrativeEventHistory.execute()).events,
  };
}

function authenticated(
  app: ReturnType<typeof createApp>,
  route: string,
  token: string,
  confirmation: string,
) {
  return request(app)
    .post(route)
    .set("Cf-Access-Jwt-Assertion", token)
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ ...OCCURRENCE, confirmation }));
}
