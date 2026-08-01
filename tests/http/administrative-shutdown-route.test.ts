import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE,
  ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE,
  type AdministrativeShutdownRouteDependencies,
  type ProtectedAdministrativeShutdown,
} from "../../src/http/administrative-shutdown-route.js";
import { FixedAdministrativePowerOperationGate } from "../../src/http/administrative-power-operation-gate.js";
import { FixedAdministrativeRequestAdmission } from "../../src/http/administrative-request-admission.js";
import { createApp } from "../../src/http/create-app.js";
import { mapMachineShutdownExecutionResponse } from "../../src/http/administrative-shutdown-response.js";

const NOW = new Date("2026-08-01T14:00:00.000Z");
const OCCURRENCE = {
  operation: "shutdown" as const,
  scheduledFor: NOW.toISOString(),
  wakeScheduledFor: "2026-08-02T09:00:00.000Z",
};

function createFixture(
  overrides: Partial<ProtectedAdministrativeShutdown> = {},
) {
  const clock = { now: vi.fn(() => NOW) };
  const protectedAdministration: ProtectedAdministrativeShutdown = {
    prepareMachineShutdownOccurrence: {
      execute: vi.fn(async () => ({
        occurrence: OCCURRENCE,
        processedAt: NOW.toISOString(),
        outcome: "prepared" as const,
        completedStepCount: 3,
        blockers: [],
        steps: [{ outcome: "completed" }],
        initialDecision: {
          occurrence: OCCURRENCE,
          evaluatedAt: NOW.toISOString(),
          outcome: "approved" as const,
          blockers: [],
        },
      })),
    },
    executeMachineShutdownOccurrence: {
      execute: vi.fn(async () => ({
        occurrence: OCCURRENCE,
        processedAt: NOW.toISOString(),
        outcome: "executed" as const,
        wakeAlarmMutation: {
          operation: "schedule" as const,
          requestedAt: NOW.toISOString(),
          outcome: "scheduled" as const,
          before: { state: "not_scheduled" as const },
          after: {
            state: "scheduled" as const,
            scheduledFor: OCCURRENCE.wakeScheduledFor,
          },
        },
        shutdownResult: {
          operation: "shutdown" as const,
          requestedAt: NOW.toISOString(),
          outcome: "simulated" as const,
        },
      })),
    },
    ...overrides,
  };
  const createProtectedAdministration = vi.fn(() => protectedAdministration);
  const dependencies: AdministrativeShutdownRouteDependencies = {
    admission: new FixedAdministrativeRequestAdmission(clock),
    powerOperationGate: new FixedAdministrativePowerOperationGate(),
    createProtectedAdministration,
  };
  const app = createApp({
    logger: { error: vi.fn() },
    getServerHealth: { execute: vi.fn() },
    administrativeShutdown: dependencies,
  });
  return { app, protectedAdministration, createProtectedAdministration };
}

function body(stage: "preparation" | "execution") {
  return {
    ...OCCURRENCE,
    confirmation:
      stage === "preparation"
        ? "confirm_shutdown_preparation"
        : "confirm_shutdown_execution",
  };
}

describe("protected shutdown routes", () => {
  it("preserves accepted helper shutdown semantics in the HTTP mapper", () => {
    const response = mapMachineShutdownExecutionResponse({
      occurrence: OCCURRENCE,
      processedAt: NOW.toISOString(),
      outcome: "executed",
      wakeAlarmMutation: {
        operation: "schedule",
        requestedAt: NOW.toISOString(),
        outcome: "scheduled",
        before: { state: "not_scheduled" },
        after: {
          state: "scheduled",
          scheduledFor: OCCURRENCE.wakeScheduledFor,
        },
      },
      shutdownResult: {
        operation: "shutdown",
        requestedAt: NOW.toISOString(),
        outcome: "accepted",
      },
    });

    expect(response.shutdown).toEqual({ outcome: "accepted" });
  });

  it("maps preparation through the protected facade with a request confirmation", async () => {
    const fixture = createFixture();
    const response = await request(fixture.app)
      .post(ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(body("preparation")));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      occurrence: OCCURRENCE,
      processedAt: NOW.toISOString(),
      outcome: "prepared",
      completedStepCount: 1,
      blockers: [],
    });
    expect(
      fixture.protectedAdministration.prepareMachineShutdownOccurrence.execute,
    ).toHaveBeenCalledWith(OCCURRENCE);
    expect(fixture.createProtectedAdministration).toHaveBeenCalledOnce();
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store, private");
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
  });

  it("requires a new stage-specific execution confirmation", async () => {
    const fixture = createFixture();
    const wrongStage = await request(fixture.app)
      .post(ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE)
      .set("Content-Type", "application/json")
      .send(
        JSON.stringify({
          ...body("execution"),
          confirmation: "confirm_shutdown_preparation",
        }),
      );
    const correct = await request(fixture.app)
      .post(ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(body("execution")));

    expect(wrongStage.status).toBe(400);
    expect(correct.status).toBe(200);
    expect(
      fixture.protectedAdministration.executeMachineShutdownOccurrence.execute,
    ).toHaveBeenCalledOnce();
  });

  it("rejects methods, queries, unsupported media, and oversized bodies safely", async () => {
    const fixture = createFixture();
    const method = await request(fixture.app).get(
      ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE,
    );
    const query = await request(fixture.app).post(
      `${ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE}?x=1`,
    );
    const media = await request(fixture.app)
      .post(ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE)
      .set("Content-Type", "text/plain")
      .send("{}");
    const oversized = await request(fixture.app)
      .post(ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE)
      .set("Content-Type", "application/json")
      .send(
        JSON.stringify({ ...body("preparation"), extra: "x".repeat(1_100) }),
      );

    expect(method.status).toBe(405);
    expect(method.headers.allow).toBe("POST");
    expect(query.status).toBe(400);
    expect(media.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(fixture.createProtectedAdministration).not.toHaveBeenCalled();
  });

  it("does not register aliases when the shutdown dependency is absent", async () => {
    const app = createApp({
      logger: { error: vi.fn() },
      getServerHealth: { execute: vi.fn() },
    });
    expect(
      (await request(app).post(ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE))
        .status,
    ).toBe(404);
    expect((await request(app).post("/admin/power/shutdown-now")).status).toBe(
      404,
    );
  });

  it("shares a fail-fast power-operation gate", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = createFixture({
      prepareMachineShutdownOccurrence: {
        execute: vi.fn(async () => {
          await pending;
          return {
            occurrence: OCCURRENCE,
            processedAt: NOW.toISOString(),
            outcome: "prepared" as const,
            blockers: [],
            steps: [],
            initialDecision: {
              occurrence: OCCURRENCE,
              evaluatedAt: NOW.toISOString(),
              outcome: "approved" as const,
              blockers: [],
            },
          };
        }),
      },
    });
    const first = request(fixture.app)
      .post(ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(body("preparation")))
      .then((response) => response);
    while (
      !vi.mocked(
        fixture.protectedAdministration.prepareMachineShutdownOccurrence
          .execute,
      ).mock.calls.length
    )
      await new Promise((resolve) => setImmediate(resolve));
    const second = await request(fixture.app)
      .post(ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(body("execution")));
    release!();
    await first;

    expect(second.status).toBe(409);
    expect((second.body as { error: { code: string } }).error.code).toBe(
      "administrative_power_operation_busy",
    );
  });
});
