import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { AdministrativeAccessControlError } from "../../src/access-control/application/errors.js";
import { WakeAlarmScheduleValidationError } from "../../src/power-management/domain/wake-alarm-schedule.js";
import {
  FixedAdministrativeRequestAdmission,
  type AdministrativeRequestClock,
} from "../../src/http/administrative-request-admission.js";
import {
  ADMINISTRATIVE_WAKE_ALARM_ROUTE,
  type AdministrativeWakeAlarmRouteDependencies,
  type ProtectedAdministrativeWakeAlarm,
} from "../../src/http/administrative-wake-alarm-route.js";
import { createApp } from "../../src/http/create-app.js";
import { FixedAdministrativeWakeAlarmMutationGate } from "../../src/http/administrative-wake-alarm-mutation-gate.js";

const NOW = new Date("2026-08-01T14:00:00.000Z");
const LATER = "2026-08-02T09:00:00.000Z";

function createFixture(
  overrides: Partial<ProtectedAdministrativeWakeAlarm> = {},
) {
  const clock: AdministrativeRequestClock = { now: () => NOW };
  const protectedAdministration: ProtectedAdministrativeWakeAlarm = {
    getNextWakeAlarm: {
      execute: vi.fn(async () => ({
        observedAt: NOW.toISOString(),
        wakeAlarm: { state: "not_scheduled" },
      })),
    },
    scheduleWakeAlarm: {
      execute: vi.fn(async () => ({
        operation: "schedule",
        requestedAt: NOW.toISOString(),
        outcome: "scheduled",
        before: { state: "not_scheduled" },
        after: { state: "scheduled", scheduledFor: LATER },
      })),
    },
    cancelWakeAlarm: {
      execute: vi.fn(async () => ({
        operation: "cancel",
        requestedAt: NOW.toISOString(),
        outcome: "not_scheduled",
        before: { state: "not_scheduled" },
        after: { state: "not_scheduled" },
      })),
    },
    ...overrides,
  };
  const createProtectedAdministration = vi.fn(() => protectedAdministration);
  const dependencies: AdministrativeWakeAlarmRouteDependencies = {
    admission: new FixedAdministrativeRequestAdmission(clock),
    mutationGate: new FixedAdministrativeWakeAlarmMutationGate(),
    createProtectedAdministration,
  };
  const app = createApp({
    logger: { error: vi.fn() },
    getServerHealth: { execute: vi.fn() },
    administrativeWakeAlarm: dependencies,
  });
  return { app, protectedAdministration, createProtectedAdministration };
}

describe("GET /admin/power/wake-alarm", () => {
  it("returns an explicit not-scheduled observation", async () => {
    const fixture = createFixture();
    const response = await request(fixture.app).get(
      ADMINISTRATIVE_WAKE_ALARM_ROUTE,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      observedAt: NOW.toISOString(),
      wakeAlarm: { state: "not_scheduled" },
    });
    expect(
      fixture.protectedAdministration.getNextWakeAlarm.execute,
    ).toHaveBeenCalledOnce();
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store, private");
  });

  it("rejects queries and bodies before creating a protected capability", async () => {
    const fixture = createFixture();
    const query = await request(fixture.app).get(
      `${ADMINISTRATIVE_WAKE_ALARM_ROUTE}?value=x`,
    );
    const body = await request(fixture.app)
      .get(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .set("Content-Length", "1")
      .send("x");

    expect(query.status).toBe(400);
    expect(body.status).toBe(400);
    expect(fixture.createProtectedAdministration).not.toHaveBeenCalled();
  });
});

describe("wake-alarm methods", () => {
  it("supports PUT and DELETE with explicit mappers", async () => {
    const fixture = createFixture();
    const put = await request(fixture.app)
      .put(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ scheduledFor: LATER }));
    const deletion = await request(fixture.app).delete(
      ADMINISTRATIVE_WAKE_ALARM_ROUTE,
    );

    expect(put.status).toBe(200);
    expect(put.body).toEqual({
      operation: "schedule",
      requestedAt: NOW.toISOString(),
      outcome: "scheduled",
      before: { state: "not_scheduled" },
      after: { state: "scheduled", scheduledFor: LATER },
    });
    expect(deletion.status).toBe(200);
    expect(deletion.body).toEqual({
      operation: "cancel",
      requestedAt: NOW.toISOString(),
      outcome: "not_scheduled",
      before: { state: "not_scheduled" },
      after: { state: "not_scheduled" },
    });
  });

  it.each(["head", "post", "patch", "options"] as const)(
    "rejects %s with the exact Allow header",
    async (method) => {
      const fixture = createFixture();
      const response = await request(fixture.app)[method](
        ADMINISTRATIVE_WAKE_ALARM_ROUTE,
      );
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET, PUT, DELETE");
    },
  );

  it("is not registered when its dependency is absent", async () => {
    const response = await request(
      createApp({
        logger: { error: vi.fn() },
        getServerHealth: { execute: vi.fn() },
      }),
    ).get(ADMINISTRATIVE_WAKE_ALARM_ROUTE);
    expect(response.status).toBe(404);
  });
});

describe("wake-alarm PUT validation", () => {
  it("rejects malformed, duplicate-key, unsupported-media, and non-future requests", async () => {
    const fixture = createFixture();
    const malformed = await request(fixture.app)
      .put(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .set("Content-Type", "application/json")
      .send("[]");
    const media = await request(fixture.app)
      .put(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .set("Content-Type", "text/plain")
      .send("{}");
    const duplicate = await request(fixture.app)
      .put(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .set("Content-Type", "application/json")
      .send(`{"scheduledFor":"${LATER}","scheduledFor":"${LATER}"}`);
    const pastFixture = createFixture({
      scheduleWakeAlarm: {
        execute: vi.fn(async () => {
          throw new WakeAlarmScheduleValidationError(
            "scheduled_for_not_future",
          );
        }),
      },
    });
    const past = await request(pastFixture.app)
      .put(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ scheduledFor: "2026-08-01T13:00:00.000Z" }));

    expect(errorCode(malformed)).toBe("invalid_wake_alarm_request");
    expect(errorCode(media)).toBe("unsupported_media_type");
    expect(errorCode(duplicate)).toBe("invalid_wake_alarm_request");
    expect(past.status).toBe(422);
    expect(errorCode(past)).toBe("wake_alarm_schedule_not_future");
  });

  it("rejects bodies larger than 512 bytes", async () => {
    const fixture = createFixture();
    const response = await request(fixture.app)
      .put(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ scheduledFor: LATER, extra: "x".repeat(600) }));
    expect(response.status).toBe(413);
    expect(errorCode(response)).toBe("payload_too_large");
  });
});

describe("wake-alarm mutation gate", () => {
  it("fails fast and releases after the first mutation completes", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = createFixture({
      scheduleWakeAlarm: {
        execute: vi.fn(async () => {
          await pending;
          return {
            operation: "schedule",
            requestedAt: NOW.toISOString(),
            outcome: "scheduled",
            before: { state: "not_scheduled" },
            after: { state: "scheduled", scheduledFor: LATER },
          };
        }),
      },
    });
    const first = request(fixture.app)
      .put(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ scheduledFor: LATER }))
      .then((response) => response);
    await vi.waitFor(() =>
      expect(fixture.createProtectedAdministration).toHaveBeenCalledOnce(),
    );
    const second = await request(fixture.app)
      .delete(ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      .expect(409);
    expect(errorCode(second)).toBe("administrative_wake_alarm_busy");
    release?.();
    await expect(first).resolves.toMatchObject({ status: 200 });
  });
});

it("maps protected authentication failures safely", async () => {
  const fixture = createFixture({
    getNextWakeAlarm: {
      execute: vi.fn(async () => {
        throw new AdministrativeAccessControlError(
          "administrative_authentication_required",
        );
      }),
    },
  });
  const response = await request(fixture.app).get(
    ADMINISTRATIVE_WAKE_ALARM_ROUTE,
  );
  expect(response.status).toBe(401);
  expect(response.body as unknown).toEqual({
    error: {
      code: "administrative_authentication_required",
      message: "Administrative authentication required",
    },
  });
});

function errorCode(response: { body: unknown }): string {
  const body = response.body as { error: { code: string } };
  return body.error.code;
}
