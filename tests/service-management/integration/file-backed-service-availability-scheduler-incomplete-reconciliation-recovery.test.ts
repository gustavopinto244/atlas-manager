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

const directories: string[] = [];
const serviceId = "atlas-api";
const externalResourceId = "atlas-api-pm2";
const processId = 42;
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
    REGISTERED_SERVICES_JSON: JSON.stringify([
      {
        id: serviceId,
        displayName: "Atlas API",
        managementAdapter: "pm2",
        externalResourceId,
        supportedOperations: ["readStatus", "start", "stop"],
        availabilityPolicy: {
          mode: "scheduled",
          timezone: "America/Sao_Paulo",
          windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
        },
      },
    ]),
  };
}

function processList(): Pm2ProcessListExecutor {
  return {
    execute: vi.fn<Pm2ProcessListExecutor["execute"]>().mockResolvedValue(
      JSON.stringify([
        {
          name: externalResourceId,
          pm_id: processId,
          pm2_env: { status: "online" },
        },
      ]),
    ),
  };
}

function occurrence(
  operation: "start" | "stop",
  scheduledFor: string,
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId,
    operation,
    scheduledFor,
  });
}

describe("file-backed incomplete reconciliation recovery", () => {
  it("preserves claims during a failed occurrence and recovers after reconstruction", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-incomplete-reconciliation-recovery-"),
    );
    directories.push(directory);
    const overridePath = join(directory, "availability-overrides.json");
    const claimPath = join(directory, "reconciliation-occurrence-claims.json");
    const cursorPath = join(directory, "reconciliation-scheduler-cursor.json");
    const initialCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: t0,
      });
    const historical = occurrence("start", t0);
    const current = occurrence("stop", t1);
    const controlFailure = new Error("controlled service-control failure");
    const controlExecute = vi
      .fn<Pm2ServiceControlExecutor["execute"]>()
      .mockRejectedValueOnce(controlFailure)
      .mockResolvedValue(undefined);
    const controlExecutor: Pm2ServiceControlExecutor = {
      execute: controlExecute,
    };

    const setupCursor =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(
      setupCursor.advance(null, initialCursor),
    ).resolves.toMatchObject({ kind: "advanced" });
    const setupClaims =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(setupClaims.claim(historical)).resolves.toEqual({
      kind: "claimed",
    });
    const expired = createServiceAvailabilityOverride(
      { kind: "keep_available", expiresAt: "2026-07-27T19:00:00.000Z" },
      new Date("2026-07-27T18:00:00.000Z"),
    );
    await new FileServiceAvailabilityOverrideStore(overridePath).save(
      serviceId,
      expired,
    );
    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(initialCursor);

    const first = createServiceManagement(environment(), {
      clock: clock(
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
    const firstResult =
      await first.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(firstResult.kind).toBe("incomplete");
    if (firstResult.kind !== "incomplete")
      throw new Error("expected incomplete cycle");
    expect(firstResult.cursor).toEqual(initialCursor);
    expect(firstResult.report).toMatchObject([
      {
        occurrenceResults: [
          {
            kind: "failed",
            occurrence: current,
            error: controlFailure,
          },
        ],
      },
    ]);
    expect(firstResult.pruningReport).toEqual([{ kind: "removed", serviceId }]);
    expect(firstResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(Object.isFrozen(firstResult)).toBe(true);
    expect(controlExecute).toHaveBeenCalledExactlyOnceWith("stop", processId);

    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(initialCursor);
    await expect(
      new FileServiceAvailabilityOverrideStore(overridePath).findByServiceId(
        serviceId,
      ),
    ).resolves.toBeNull();
    const afterFirstClaims =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(afterFirstClaims.claim(current)).resolves.toEqual({
      kind: "duplicate",
    });

    const retry = createServiceManagement(environment(), {
      clock: clock(
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
    expect(retryResult.report).toMatchObject([
      {
        occurrenceResults: [
          { occurrence: current, result: { kind: "duplicate" } },
        ],
      },
    ]);
    expect(retryResult.pruningReport).toEqual([
      { kind: "no_override", serviceId },
    ]);
    expect(retryResult.occurrenceClaimPruningResult).toEqual({
      kind: "unchanged",
    });
    expect(Object.isFrozen(retryResult)).toBe(true);
    expect(controlExecute).toHaveBeenCalledTimes(1);

    await expect(
      new FileServiceAvailabilityOverrideStore(overridePath).findByServiceId(
        serviceId,
      ),
    ).resolves.toBeNull();
    const finalClaims =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(finalClaims.claim(historical)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(finalClaims.claim(current)).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(retryResult.cursor);
  });
});
