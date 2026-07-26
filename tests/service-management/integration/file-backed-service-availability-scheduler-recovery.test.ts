import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { FileServiceAvailabilityOverrideStore } from "../../../src/service-management/infrastructure/file-service-availability-override-store.js";
import { FileServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";
import { createServiceAvailabilityOverride } from "../../../src/service-scheduling/domain/service-availability-override.js";

const temporaryDirectories: string[] = [];
const serviceId = "atlas-api";
const externalResourceId = "atlas-api-mock";
const firstCompletedThrough = "2026-07-27T12:00:00.000Z";
const secondCompletedThrough = "2026-07-27T20:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createClock(...timestamps: readonly string[]): Clock {
  const remainingTimestamps = [...timestamps];

  return {
    now: vi.fn(() => {
      const timestamp = remainingTimestamps.shift();

      if (timestamp === undefined) {
        throw new Error("Controlled integration clock was exhausted");
      }

      return new Date(timestamp);
    }),
  };
}

function createEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    REGISTERED_SERVICES_JSON: JSON.stringify([
      {
        id: serviceId,
        displayName: "Atlas API",
        managementAdapter: "mock",
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

function createOccurrence(
  operation: "start" | "stop",
  scheduledFor: string,
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId,
    operation,
    scheduledFor,
  });
}

describe("file-backed service availability scheduler recovery", () => {
  it("preserves cursor, override, and occurrence-claim behavior across reconstructed compositions", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-scheduler-recovery-"),
    );
    temporaryDirectories.push(directory);
    const overridePath = join(directory, "availability-overrides.json");
    const claimPath = join(directory, "reconciliation-occurrence-claims.json");
    const cursorPath = join(directory, "reconciliation-scheduler-cursor.json");
    const environment = createEnvironment();
    const firstOccurrence = createOccurrence("start", firstCompletedThrough);
    const secondOccurrence = createOccurrence("stop", secondCompletedThrough);

    const initialOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    const expiredOverride = createServiceAvailabilityOverride(
      {
        kind: "keep_available",
        expiresAt: "2026-07-27T11:00:00.000Z",
      },
      new Date("2026-07-27T10:00:00.000Z"),
    );
    await initialOverrideStore.save(serviceId, expiredOverride);

    const firstOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    const firstClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const firstCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const firstComposition = createServiceManagement(environment, {
      clock: createClock(
        "2026-07-27T12:00:30.000Z",
        "2026-07-27T12:00:30.000Z",
        "2026-07-27T12:00:31.000Z",
        "2026-07-27T12:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore: firstOverrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore: firstClaimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore: firstCursorStore,
      mockStatusConfiguration: [{ externalResourceId, state: "stopped" }],
    });

    await expect(firstCursorStore.read()).resolves.toBeNull();

    const firstResult =
      await firstComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(firstResult.kind).toBe("advanced");
    if (firstResult.kind !== "advanced") {
      throw new Error("Expected first scheduler cycle to advance");
    }
    expect(firstResult.cursor.completedThrough).toBe(firstCompletedThrough);
    expect(firstResult.report).toMatchObject([
      {
        kind: "completed",
        serviceId,
        occurrenceResults: [
          {
            kind: "completed",
            occurrence: firstOccurrence,
            result: { kind: "executed" },
          },
        ],
      },
    ]);
    expect(firstResult.pruningReport).toEqual([{ kind: "removed", serviceId }]);
    expect(firstResult.occurrenceClaimPruningResult).toEqual({
      kind: "no_cursor",
    });
    expect(Object.isFrozen(firstResult)).toBe(true);
    expect(Object.isFrozen(firstResult.occurrenceClaimPruningResult)).toBe(
      true,
    );
    expect(JSON.stringify(firstResult)).not.toContain(directory);

    const afterFirstOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    const afterFirstClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const afterFirstCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(
      afterFirstOverrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();
    await expect(afterFirstCursorStore.read()).resolves.toEqual(
      firstResult.cursor,
    );
    await expect(afterFirstClaimStore.claim(firstOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });

    const secondOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    const secondClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const secondCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const persistedFirstCursor = await secondCursorStore.read();
    expect(persistedFirstCursor).toEqual(firstResult.cursor);
    const secondComposition = createServiceManagement(environment, {
      clock: createClock(
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:31.000Z",
        "2026-07-27T20:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore: secondOverrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore: secondClaimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore: secondCursorStore,
      mockStatusConfiguration: [{ externalResourceId, state: "running" }],
    });

    const secondResult =
      await secondComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(secondResult.kind).toBe("advanced");
    if (secondResult.kind !== "advanced") {
      throw new Error("Expected second scheduler cycle to advance");
    }
    expect(secondResult.cursor.completedThrough).toBe(secondCompletedThrough);
    expect(secondResult.report).toMatchObject([
      {
        kind: "completed",
        serviceId,
        occurrenceResults: [
          {
            kind: "completed",
            occurrence: secondOccurrence,
            result: { kind: "executed" },
          },
        ],
      },
    ]);
    expect(secondResult.pruningReport).toEqual([
      { kind: "no_override", serviceId },
    ]);
    expect(secondResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(Object.isFrozen(secondResult)).toBe(true);
    expect(Object.isFrozen(secondResult.occurrenceClaimPruningResult)).toBe(
      true,
    );
    expect(JSON.stringify(secondResult)).not.toContain(directory);

    const finalOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    const finalClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const finalCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);

    await expect(
      finalOverrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();
    await expect(finalCursorStore.read()).resolves.toEqual(secondResult.cursor);
    await expect(finalClaimStore.claim(firstOccurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(finalClaimStore.claim(secondOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });
  });
});
