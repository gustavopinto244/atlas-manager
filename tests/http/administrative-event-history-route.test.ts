import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { FixedAdministrativeRequestAdmission } from "../../src/http/administrative-request-admission.js";
import { ADMINISTRATIVE_EVENT_HISTORY_ROUTE } from "../../src/http/administrative-event-history-route.js";
import { parseAdministrativeEventHistoryQuery } from "../../src/http/administrative-event-history-query-parser.js";
import { createApp } from "../../src/http/create-app.js";
import { createAdministrativeEvent } from "../../src/event-history/domain/administrative-event.js";
import { AdministrativeAccessControlError } from "../../src/access-control/application/errors.js";
import type { AdministrativeEventHistoryPage } from "../../src/event-history/domain/administrative-event-history-page.js";

const ATTEMPT_ID = "00000000-0000-4000-8000-000000000001";

describe("administrative event-history query parser", () => {
  it("parses the supported filters and applies domain defaults", () => {
    expect(
      parseAdministrativeEventHistoryQuery(
        "/admin/event-history?afterSequence=10&limit=25&source=administrative&operation=authorize_administrative_operation&status=succeeded&attemptId=" +
          ATTEMPT_ID +
          "&occurredFrom=2026-01-01T00%3A00%3A00.000Z&occurredTo=2026-01-02T00%3A00%3A00.000Z",
      ),
    ).toEqual({
      afterSequence: 10,
      limit: 25,
      source: "administrative",
      operation: "authorize_administrative_operation",
      status: "succeeded",
      attemptId: ATTEMPT_ID,
      occurredFrom: "2026-01-01T00:00:00.000Z",
      occurredTo: "2026-01-02T00:00:00.000Z",
    });
    expect(
      parseAdministrativeEventHistoryQuery(ADMINISTRATIVE_EVENT_HISTORY_ROUTE),
    ).toEqual({
      afterSequence: 0,
      limit: 50,
    });
  });

  it.each([
    "?limit=10&limit=20",
    "?limit[]=10",
    "?filter[source]=system",
    "?unknown=value",
    "?limit=",
    "?limit=%20",
    "?limit=01",
    "?limit=+1",
    "?limit=1.0",
    "?limit=1e2",
    "?limit=%E0%A4%A",
  ])("rejects unsafe query syntax %s", (query) => {
    expect(() =>
      parseAdministrativeEventHistoryQuery(
        `${ADMINISTRATIVE_EVENT_HISTORY_ROUTE}${query}`,
      ),
    ).toThrow();
  });
});

describe("GET /admin/event-history", () => {
  it("is not registered when the dependency is absent", async () => {
    const response = await request(
      createApp({
        logger: { error: vi.fn() },
        getServerHealth: { execute: vi.fn() },
      }),
    ).get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE);

    expect(response.status).toBe(404);
  });

  it("returns a bounded explicit event representation with security headers", async () => {
    const event = createAdministrativeEvent({
      sequence: 1,
      attemptId: ATTEMPT_ID,
      occurredAt: "2026-01-01T00:00:00.000Z",
      source: { kind: "administrative", actorId: "unauthenticated" },
      target: { kind: "machine", id: "atlas" },
      operation: "authorize_administrative_operation",
      status: "rejected",
      details: {
        requestedOperation: "read_administrative_event_history",
        permission: "event_history.read",
        decision: "denied",
        reasonCode: "credentials_absent",
      },
    });
    const execute = vi.fn(async () => ({ events: [event], hasMore: false }));
    const response = await request(
      createApp(
        createBaseDependencies({
          createProtectedEventHistoryQuery: () => ({ execute }),
        }),
      ),
    ).get(`${ADMINISTRATIVE_EVENT_HISTORY_ROUTE}?limit=1`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      events: [
        {
          sequence: 1,
          attemptId: ATTEMPT_ID,
          occurredAt: "2026-01-01T00:00:00.000Z",
          source: { kind: "administrative", actorId: "unauthenticated" },
          target: { kind: "machine", id: "atlas" },
          operation: "authorize_administrative_operation",
          status: "rejected",
          details: {
            requestedOperation: "read_administrative_event_history",
            permission: "event_history.read",
            decision: "denied",
            reasonCode: "credentials_absent",
          },
        },
      ],
      hasMore: false,
    });
    expect(execute).toHaveBeenCalledWith({ afterSequence: 0, limit: 1 });
    expect(response.headers["cache-control"]).toBe("no-store, private");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects methods other than GET with Allow", async () => {
    const app = createApp(
      createBaseDependencies({ createProtectedEventHistoryQuery: vi.fn() }),
    );
    for (const method of [
      "head",
      "post",
      "put",
      "patch",
      "delete",
      "options",
    ] as const) {
      const response = await request(app)[method](
        ADMINISTRATIVE_EVENT_HISTORY_ROUTE,
      );
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET");
    }
  });

  it("rejects bodies before creating the request-scoped protected capability", async () => {
    const createProtected = vi.fn();
    const response = await request(
      createApp(
        createBaseDependencies({
          createProtectedEventHistoryQuery: createProtected,
        }),
      ),
    )
      .get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE)
      .set("Content-Length", "1")
      .send("x");

    expect(response.status).toBe(400);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe("invalid_administrative_request");
    expect(createProtected).not.toHaveBeenCalled();
  });

  it("rejects an overlong request target before authentication", async () => {
    const createProtected = vi.fn();
    const response = await request(
      createApp(
        createBaseDependencies({
          createProtectedEventHistoryQuery: createProtected,
        }),
      ),
    ).get(`${ADMINISTRATIVE_EVENT_HISTORY_ROUTE}?${"a".repeat(4_100)}`);

    expect(response.status).toBe(414);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe("uri_too_long");
    expect(createProtected).not.toHaveBeenCalled();
  });

  it("rejects a fifth concurrent request without queueing it", async () => {
    let releaseQuery: (() => void) | undefined;
    const queryFinished = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const createProtected = vi.fn(() => ({
      execute: async () => {
        await queryFinished;
        return { events: [], hasMore: false };
      },
    }));
    const app = createApp(
      createBaseDependencies({
        createProtectedEventHistoryQuery: createProtected,
      }),
    );

    const admitted = Array.from({ length: 4 }, () =>
      request(app)
        .get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE)
        .then((response) => response),
    );
    await vi.waitFor(() => expect(createProtected).toHaveBeenCalledTimes(4));
    const rejected = await request(app).get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE);

    expect(rejected.status).toBe(429);
    expect(createProtected).toHaveBeenCalledTimes(4);
    releaseQuery?.();
    const responses = await Promise.all(admitted);
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });

  it("rejects a response that exceeds the one-megabyte bound", async () => {
    const largeEvents = Array.from({ length: 100 }, (_, index) => ({
      sequence: index + 1,
      attemptId: ATTEMPT_ID,
      occurredAt: "2026-01-01T00:00:00.000Z",
      source: { kind: "administrative", actorId: "unauthenticated" },
      target: { kind: "machine", id: "atlas" },
      operation: "schedule_wake_alarm",
      status: "succeeded",
      details: { mutationOutcome: "x".repeat(11_000) },
    }));
    const response = await request(
      createApp(
        createBaseDependencies({
          createProtectedEventHistoryQuery: () => ({
            execute: async () =>
              ({
                events: largeEvents,
                hasMore: false,
              }) as unknown as AdministrativeEventHistoryPage,
          }),
        }),
      ),
    ).get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE);

    expect(response.status).toBe(500);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe("internal_error");
  });

  it("maps authentication, authorization, and target failures safely", async () => {
    const cases = [
      [
        new AdministrativeAccessControlError(
          "administrative_authentication_required",
        ),
        401,
        "administrative_authentication_required",
      ],
      [
        new AdministrativeAccessControlError(
          "administrative_authorization_denied",
        ),
        403,
        "administrative_authorization_denied",
      ],
      [
        new AdministrativeAccessControlError(
          "administrative_identity_unavailable",
        ),
        503,
        "administrative_identity_unavailable",
      ],
      [
        new AdministrativeAccessControlError("protected_operation_failed"),
        503,
        "administrative_event_history_unavailable",
      ],
    ] as const;
    for (const [error, status, code] of cases) {
      const response = await request(
        createApp(
          createBaseDependencies({
            createProtectedEventHistoryQuery: () => ({
              execute: async () => {
                throw error;
              },
            }),
          }),
        ),
      ).get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE);
      expect(response.status).toBe(status);
      const errorBody = response.body as {
        error: { code: string; message: string };
      };
      expect(errorBody.error.code).toBe(code);
      expect(typeof errorBody.error.message).toBe("string");
      expect(JSON.stringify(response.body)).not.toContain("Cloudflare");
    }
  });

  it("rejects the sixty-first request and does not invoke the protected capability", async () => {
    const clock = { now: vi.fn(() => new Date("2026-01-01T00:00:00.000Z")) };
    const createProtected = vi.fn(() => ({
      execute: async () => ({ events: [], hasMore: false }),
    }));
    const dependencies = createBaseDependencies({
      admission: new FixedAdministrativeRequestAdmission(clock, {
        maximumConcurrent: 100,
      }),
      createProtectedEventHistoryQuery: createProtected,
    });
    const app = createApp(dependencies);
    for (let index = 0; index < 60; index += 1)
      expect(
        (await request(app).get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE)).status,
      ).toBe(200);
    const response = await request(app).get(ADMINISTRATIVE_EVENT_HISTORY_ROUTE);
    expect(response.status).toBe(429);
    expect(createProtected).toHaveBeenCalledTimes(60);
    expect(response.headers["retry-after"]).toBe("1");
  });
});

type RouteOverrides = Partial<
  NonNullable<Parameters<typeof createApp>[0]["administrativeEventHistory"]>
>;

function createBaseDependencies(overrides: RouteOverrides = {}) {
  const clock = { now: vi.fn(() => new Date("2026-01-01T00:00:00.000Z")) };
  return {
    logger: { error: vi.fn() },
    getServerHealth: { execute: vi.fn() },
    administrativeEventHistory: {
      admission:
        overrides.admission ?? new FixedAdministrativeRequestAdmission(clock),
      createProtectedEventHistoryQuery:
        overrides.createProtectedEventHistoryQuery ??
        (() => ({ execute: async () => ({ events: [], hasMore: false }) })),
    },
  };
}
