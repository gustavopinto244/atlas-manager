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
import {
  ADMINISTRATIVE_WAKE_ALARM_ROUTE,
  type AdministrativeWakeAlarmRouteDependencies,
} from "../../src/http/administrative-wake-alarm-route.js";
import { FixedAdministrativeWakeAlarmMutationGate } from "../../src/http/administrative-wake-alarm-mutation-gate.js";
import { createApp } from "../../src/http/create-app.js";
import { createPowerManagement } from "../../src/power-management/composition/create-power-management.js";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-01T14:00:00.000Z");
const T1 = "2026-08-02T09:00:00.000Z";
const T2 = "2026-08-03T09:00:00.000Z";

describe("protected wake-alarm lifecycle", () => {
  it("verifies, authorizes, audits, and executes the complete mock lifecycle", async () => {
    const fixture = await createFixture();
    const app = createApp(fixture.app);

    const getInitial = await authenticated(app, "get", fixture.token);
    const scheduled = await authenticated(app, "put", fixture.token, T1);
    const getScheduled = await authenticated(app, "get", fixture.token);
    const unchanged = await authenticated(app, "put", fixture.token, T1);
    const replaced = await authenticated(app, "put", fixture.token, T2);
    const cancelled = await authenticated(app, "delete", fixture.token);
    const absent = await authenticated(app, "delete", fixture.token);
    const getFinal = await authenticated(app, "get", fixture.token);

    expect(wakeBody(getInitial).wakeAlarm?.state).toBe("not_scheduled");
    expect(wakeBody(scheduled).outcome).toBe("scheduled");
    expect(wakeBody(getScheduled).wakeAlarm).toEqual({
      state: "scheduled",
      scheduledFor: T1,
    });
    expect(wakeBody(unchanged).outcome).toBe("unchanged");
    expect(wakeBody(replaced).outcome).toBe("replaced");
    expect(wakeBody(cancelled).outcome).toBe("cancelled");
    expect(wakeBody(absent).outcome).toBe("not_scheduled");
    expect(wakeBody(getFinal).wakeAlarm?.state).toBe("not_scheduled");

    const events = await fixture.events();
    expect(events.map((event) => [event.operation, event.status])).toEqual([
      ["authorize_administrative_operation", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
      ["schedule_wake_alarm", "started"],
      ["schedule_wake_alarm", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
      ["schedule_wake_alarm", "started"],
      ["schedule_wake_alarm", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
      ["schedule_wake_alarm", "started"],
      ["schedule_wake_alarm", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
      ["cancel_wake_alarm", "started"],
      ["cancel_wake_alarm", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
      ["cancel_wake_alarm", "started"],
      ["cancel_wake_alarm", "succeeded"],
      ["authorize_administrative_operation", "succeeded"],
    ]);
    expect(
      events.every(
        (event) => event.source.actorId === `administrator:${PRINCIPAL_ID}`,
      ),
    ).toBe(true);
  });

  it("denies an auditor without invoking the wake capability", async () => {
    const fixture = await createFixture(["auditor"]);
    const response = await authenticated(
      createApp(fixture.app),
      "get",
      fixture.token,
    );
    expect(response.status).toBe(403);
    expect(fixture.wakeReader).not.toHaveBeenCalled();
  });
});

async function createFixture(roles: string[] = ["power_operator"]) {
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
    assignments: [{ principalId: PRINCIPAL_ID, roles }],
  });
  const fetchWithCount = async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  const authentication = createCloudflareAccessAdministrativeAuthentication({
    configuration,
    clock,
    overrides: { fetch: fetchWithCount },
  });
  const wakeReader = roles.includes("auditor")
    ? vi.fn(async (observedAt: string) => ({
        observedAt,
        wakeAlarm: { state: "not_scheduled" as const },
      }))
    : undefined;
  const power = createPowerManagement({
    clock,
    administrativeEventHistoryCapabilities: history,
    ...(wakeReader === undefined
      ? {}
      : { wakeAlarmReader: { read: wakeReader } }),
  });
  const admission = new FixedAdministrativeRequestAdmission(clock);
  const mutationGate = new FixedAdministrativeWakeAlarmMutationGate();
  const dependencies: AdministrativeWakeAlarmRouteDependencies = {
    admission,
    mutationGate,
    createProtectedAdministration: (reader) => {
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
      });
    },
  };
  return {
    token,
    app: {
      logger: { error: vi.fn() },
      getServerHealth: { execute: vi.fn() },
      administrativeWakeAlarm: dependencies,
    },
    wakeReader,
    events: async () =>
      (await history.getAdministrativeEventHistory.execute()).events,
  };
}

async function authenticated(
  app: ReturnType<typeof createApp>,
  method: "get" | "put" | "delete",
  token: string,
  scheduledFor?: string,
) {
  const builder = request(app)
    [method](ADMINISTRATIVE_WAKE_ALARM_ROUTE)
    .set("Cf-Access-Jwt-Assertion", token);
  if (scheduledFor !== undefined)
    builder
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ scheduledFor }));
  return builder;
}

function wakeBody(response: { body: unknown }): {
  readonly outcome?: string;
  readonly wakeAlarm?: {
    readonly state: string;
    readonly scheduledFor?: string;
  };
} {
  return response.body as {
    readonly outcome?: string;
    readonly wakeAlarm?: {
      readonly state: string;
      readonly scheduledFor?: string;
    };
  };
}
