import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import { FileServiceAvailabilityOverrideStore } from "../../../src/service-management/infrastructure/file-service-availability-override-store.js";
import { FileServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import type { Pm2ServiceControlExecutor } from "../../../src/service-management/infrastructure/pm2-service-control-executor.js";
import { createServiceAvailabilityOverride } from "../../../src/service-scheduling/domain/service-availability-override.js";
import type { OrchestrationResult } from "../../../src/service-management/domain/orchestration-plan.js";
import { createMockOrchestrate } from "../../test-helpers/mock-orchestrate.js";

function createSuccessfulOrchestrationResult(
  serviceId: string,
  operation: "start" | "stop" | "restart",
): OrchestrationResult {
  return Object.freeze({
    targetServiceId: serviceId,
    requestedOperation: operation,
    startedAt: "2026-07-27T20:00:30.000Z",
    completedAt: "2026-07-27T20:00:30.000Z",
    steps: Object.freeze([
      Object.freeze({
        serviceId,
        kind: "control" as const,
        operation,
        outcome: Object.freeze({
          kind: "executed" as const,
          completedAt: "2026-07-27T20:00:30.000Z",
        }),
      }),
    ]),
    successful: true,
  });
}

function createFailedOrchestrationResult(
  serviceId: string,
  operation: "start" | "stop" | "restart",
  error: Error,
): OrchestrationResult {
  return Object.freeze({
    targetServiceId: serviceId,
    requestedOperation: operation,
    startedAt: "2026-07-27T20:00:30.000Z",
    completedAt: "2026-07-27T20:00:30.000Z",
    steps: Object.freeze([
      Object.freeze({
        serviceId,
        kind: "control" as const,
        operation,
        outcome: Object.freeze({
          kind: "failed" as const,
          error: error.message,
        }),
      }),
    ]),
    successful: false,
  });
}

const directories: string[] = [];
const services = [
  { id: "service-a", externalResourceId: "service-a-pm2", processId: 42 },
  { id: "service-b", externalResourceId: "service-b-pm2", processId: 43 },
] as const;
const t0 = "2026-07-27T12:00:00.000Z";
const t1 = "2026-07-27T20:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function clock(...values: readonly string[]): Clock {
  const remaining = [...values];
  return {
    now: vi.fn(() => {
      const value = remaining.shift();
      if (value === undefined) throw new Error("clock exhausted");
      return new Date(value);
    }),
  };
}

function environment(): Readonly<Record<string, string | undefined>> {
  return {
    REGISTERED_SERVICES_JSON: JSON.stringify(
      services.map(({ id, externalResourceId }) => ({
        id,
        displayName: id,
        managementAdapter: "pm2",
        externalResourceId,
        supportedOperations: ["readStatus", "start", "stop"],
        availabilityPolicy: {
          mode: "scheduled",
          timezone: "America/Sao_Paulo",
          windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
        },
      })),
    ),
  };
}

function processList(): Pm2ProcessListExecutor {
  return {
    execute: vi.fn<Pm2ProcessListExecutor["execute"]>().mockResolvedValue(
      JSON.stringify(
        services.map(({ externalResourceId, processId }) => ({
          name: externalResourceId,
          pm_id: processId,
          pm2_env: { status: "online" },
        })),
      ),
    ),
  };
}

function occurrence(
  serviceId: string,
  operation: "start" | "stop",
  scheduledFor: string,
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId,
    operation,
    scheduledFor,
  });
}

describe("file-backed multi-service partial reconciliation recovery", () => {
  it("preserves mixed outcomes and duplicate-protects both services after reconstruction", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-multi-service-recovery-"),
    );
    directories.push(directory);
    const overridePath = join(directory, "availability-overrides.json");
    const claimPath = join(directory, "reconciliation-occurrence-claims.json");
    const cursorPath = join(directory, "reconciliation-scheduler-cursor.json");
    const initialCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: t0,
      });
    const historical = services.map(({ id }) => occurrence(id, "start", t0));
    const current = services.map(({ id }) => occurrence(id, "stop", t1));
    const serviceBFailure = new Error("service-b control failure");
    const expectedServiceBError = new Error(
      "Orchestration failed for service-b: stop",
    );
    const controlExecutor: Pm2ServiceControlExecutor = {
      execute: vi.fn().mockResolvedValue(undefined),
    };

    const setupCursor =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(
      setupCursor.advance(null, initialCursor),
    ).resolves.toMatchObject({ kind: "advanced" });
    const setupClaims =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    for (const item of historical) {
      await expect(setupClaims.claim(item)).resolves.toEqual({
        kind: "claimed",
      });
    }
    const setupOverrides = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    for (const { id } of services) {
      await setupOverrides.save(
        id,
        createServiceAvailabilityOverride(
          { kind: "keep_available", expiresAt: "2026-07-27T19:00:00.000Z" },
          new Date("2026-07-27T18:00:00.000Z"),
        ),
      );
    }

    const firstOrchestrate = createMockOrchestrate();
    firstOrchestrate.execute.mockImplementation(
      async (serviceId, operation) => {
        if (serviceId === "service-b") {
          return createFailedOrchestrationResult(
            serviceId,
            operation,
            serviceBFailure,
          );
        }
        return createSuccessfulOrchestrationResult(serviceId, operation);
      },
    );
    const first = createServiceManagement(environment(), {
      orchestrateRegisteredServiceControl: firstOrchestrate,
      clock: clock(
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:31.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore:
        new FileServiceAvailabilityOverrideStore(overridePath),
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
          claimPath,
        ),
      serviceAvailabilityReconciliationSchedulerCursorStore:
        new FileServiceAvailabilityReconciliationSchedulerCursorStore(
          cursorPath,
        ),
      pm2ProcessListExecutor: processList(),
      pm2ControlExecutor: controlExecutor,
    });
    const firstResult =
      await first.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(firstResult.kind).toBe("incomplete");
    if (firstResult.kind !== "incomplete")
      throw new Error("expected incomplete cycle");
    const firstByService = new Map(
      firstResult.report.map((entry) => [entry.serviceId, entry]),
    );
    expect(firstByService.get("service-a")).toMatchObject({
      kind: "completed",
      occurrenceResults: [
        { occurrence: current[0], result: { kind: "executed" } },
      ],
    });
    expect(firstByService.get("service-b")).toMatchObject({
      kind: "completed",
      occurrenceResults: [
        {
          occurrence: current[1],
          kind: "failed",
          error: expectedServiceBError,
        },
      ],
    });
    expect(firstResult.pruningReport).toEqual([
      { kind: "removed", serviceId: "service-a" },
      { kind: "removed", serviceId: "service-b" },
    ]);
    expect(firstResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(firstResult.cursor).toEqual(initialCursor);
    expect(Object.isFrozen(firstResult)).toBe(true);
    expect(firstOrchestrate.execute).toHaveBeenCalledTimes(2);
    expect(firstOrchestrate.execute).toHaveBeenCalledWith(
      "service-a",
      "stop",
      "scheduled",
    );
    expect(firstOrchestrate.execute).toHaveBeenCalledWith(
      "service-b",
      "stop",
      "scheduled",
    );

    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(initialCursor);
    const afterFirstOverrides = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    for (const { id } of services) {
      await expect(afterFirstOverrides.findByServiceId(id)).resolves.toBeNull();
    }
    const afterFirstClaims =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    for (const item of current) {
      await expect(afterFirstClaims.claim(item)).resolves.toEqual({
        kind: "duplicate",
      });
    }

    const retryOrchestrate = createMockOrchestrate();
    const retry = createServiceManagement(environment(), {
      orchestrateRegisteredServiceControl: retryOrchestrate,
      clock: clock(
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore:
        new FileServiceAvailabilityOverrideStore(overridePath),
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
          claimPath,
        ),
      serviceAvailabilityReconciliationSchedulerCursorStore:
        new FileServiceAvailabilityReconciliationSchedulerCursorStore(
          cursorPath,
        ),
      pm2ProcessListExecutor: processList(),
      pm2ControlExecutor: controlExecutor,
    });
    const retryResult =
      await retry.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(retryResult.kind).toBe("advanced");
    if (retryResult.kind !== "advanced")
      throw new Error("expected retry to advance");
    expect(retryResult.cursor.completedThrough).toBe(t1);
    const retryByService = new Map(
      retryResult.report.map((entry) => [entry.serviceId, entry]),
    );
    for (const [index, service] of services.entries()) {
      expect(retryByService.get(service.id)).toMatchObject({
        kind: "completed",
        occurrenceResults: [
          { occurrence: current[index], result: { kind: "duplicate" } },
        ],
      });
    }
    expect(retryResult.pruningReport).toEqual([
      { kind: "no_override", serviceId: "service-a" },
      { kind: "no_override", serviceId: "service-b" },
    ]);
    expect(retryResult.occurrenceClaimPruningResult).toEqual({
      kind: "unchanged",
    });
    expect(Object.isFrozen(retryResult)).toBe(true);
    expect(retryOrchestrate.execute).not.toHaveBeenCalled();

    const finalClaims =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    for (const item of historical) {
      await expect(finalClaims.claim(item)).resolves.toEqual({
        kind: "claimed",
      });
    }
    for (const item of current) {
      await expect(finalClaims.claim(item)).resolves.toEqual({
        kind: "duplicate",
      });
    }
    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(retryResult.cursor);
    for (const { id } of services) {
      await expect(
        new FileServiceAvailabilityOverrideStore(overridePath).findByServiceId(
          id,
        ),
      ).resolves.toBeNull();
    }
  });
});
