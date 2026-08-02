import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { FixedAdministrativePowerOperationGate } from "../../src/http/administrative-power-operation-gate.js";
import { FixedAdministrativeRequestAdmission } from "../../src/http/administrative-request-admission.js";
import { createApp } from "../../src/http/create-app.js";

function dependencies(overrides: Record<string, unknown> = {}) {
  const values = {
    verifyEventHistoryIntegrity: {
      execute: vi.fn(async () => ({
        outcome: "verified",
        verifiedAt: "2026-08-02T12:00:00.000Z",
      })),
    },
    rotateEventHistory: {
      execute: vi.fn(async () => ({ outcome: "rotated" })),
    },
    getEventHistoryRetention: {
      execute: vi.fn(async () => ({
        policy: {
          schemaVersion: 1,
          automaticPruneEnabled: false,
          segments: {
            minSealedSegments: 1,
            maxSealedSegments: 2,
            maxSealedSegmentAgeDays: 365,
          },
          exports: { minExports: 0, maxExports: 2, maxExportAgeDays: 365 },
        },
        earliestRetainedSequence: 1,
        latestSequence: 2,
        sealedSegmentCount: 1,
        retainedEventCount: 2,
        eligibleSegmentCount: 0,
        exportCount: 0,
        eligibleExportCount: 0,
        automaticPruneEnabled: false,
      })),
    },
    setEventHistoryRetention: {
      execute: vi.fn(async (value: unknown) => value),
    },
    pruneEventHistory: {
      execute: vi.fn(async () => ({
        outcome: "unchanged",
        removedSegmentCount: 0,
        removedEventCount: 0,
      })),
    },
    listEventHistoryExports: { execute: vi.fn(async () => []) },
    getEventHistoryExport: { execute: vi.fn(async () => undefined) },
    createEventHistoryExport: {
      execute: vi.fn(async () => ({
        exportId: "a".repeat(64),
        fromSequence: 1,
        throughSequence: 2,
        eventCount: 2,
        byteCount: 10,
        createdAt: "2026-08-02T12:00:00.000Z",
        contentSha256: "b".repeat(64),
      })),
    },
    downloadEventHistoryExport: {
      execute: vi.fn(async () => Buffer.from("header\nfooter\n")),
    },
    pruneEventHistoryExports: {
      execute: vi.fn(async () => ({
        outcome: "unchanged",
        removedExportCount: 0,
      })),
    },
    ...overrides,
  };
  return {
    admission: new FixedAdministrativeRequestAdmission({
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    }),
    mutationGate: new FixedAdministrativePowerOperationGate(),
    createProtectedAdministration: () => values,
    values,
  };
}

function appWithOperations(deps: ReturnType<typeof dependencies>) {
  return createApp({
    logger: { error: vi.fn() },
    getServerHealth: { execute: vi.fn() },
    administrativeEventHistoryOperations: deps,
  });
}

describe("event-history operational routes", () => {
  it("remain absent when operations are disabled", async () => {
    const response = await request(
      createApp({
        logger: { error: vi.fn() },
        getServerHealth: { execute: vi.fn() },
      }),
    ).get("/admin/event-history/integrity");
    expect(response.status).toBe(404);
  });

  it("maps integrity and retention reads without exposing private state", async () => {
    const deps = dependencies();
    const app = appWithOperations(deps);
    const integrity = await request(app).get("/admin/event-history/integrity");
    expect(integrity.status).toBe(200);
    expect(integrity.body).toEqual({
      outcome: "verified",
      verifiedAt: "2026-08-02T12:00:00.000Z",
    });
    const retention = await request(app).get("/admin/event-history/retention");
    expect(retention.status).toBe(200);
    expect(JSON.stringify(retention.body)).not.toContain("path");
  });

  it("requires exact confirmations and bounded export ranges", async () => {
    const deps = dependencies();
    const app = appWithOperations(deps);
    const invalid = await request(app)
      .post("/admin/event-history/rotations")
      .send({ confirmation: "wrong" });
    expect(invalid.status).toBe(400);
    const valid = await request(app)
      .post("/admin/event-history/rotations")
      .set("Content-Type", "application/json")
      .send({ confirmation: "confirm_administrative_event_history_rotation" });
    expect(valid.status).toBe(200);
    const exportResponse = await request(app)
      .post("/admin/event-history/exports")
      .set("Content-Type", "application/json")
      .send({
        confirmation: "confirm_administrative_event_history_export",
        fromSequence: 1,
        throughSequence: 2,
      });
    expect(exportResponse.status).toBe(200);
    expect(deps.values.createEventHistoryExport.execute).toHaveBeenCalledWith({
      fromSequence: 1,
      throughSequence: 2,
    });
  });
});
