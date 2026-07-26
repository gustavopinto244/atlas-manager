import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type {
  ServiceAvailabilityReconciliationOccurrenceClaimPruningResult,
  ServiceAvailabilityReconciliationOccurrenceClaimResult,
  ServiceAvailabilityReconciliationOccurrenceClaimStore,
} from "../../../src/service-management/application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import { FileServiceAvailabilityOverrideStore } from "../../../src/service-management/infrastructure/file-service-availability-override-store.js";
import { FileServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import type { Pm2ServiceControlExecutor } from "../../../src/service-management/infrastructure/pm2-service-control-executor.js";
import { createServiceAvailabilityOverride } from "../../../src/service-scheduling/domain/service-availability-override.js";

const temporaryDirectories: string[] = [];
const serviceId = "atlas-api";
const externalResourceId = "atlas-api-pm2";
const processId = 42;
const initialCompletedThrough = "2026-07-27T12:00:00.000Z";
const currentCompletedThrough = "2026-07-27T20:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class FailFirstPruneOccurrenceClaimStore implements ServiceAvailabilityReconciliationOccurrenceClaimStore {
  public claimCallCount = 0;
  public pruneCallCount = 0;
  public interceptedCursor:
    ServiceAvailabilityReconciliationSchedulerCursor | undefined;
  private shouldFailPruning = true;

  public constructor(
    private readonly delegate: ServiceAvailabilityReconciliationOccurrenceClaimStore,
    private readonly failure: Error,
  ) {}

  public claim(
    occurrence: ServiceAvailabilityReconciliationOccurrence,
  ): Promise<ServiceAvailabilityReconciliationOccurrenceClaimResult> {
    this.claimCallCount += 1;
    return this.delegate.claim(occurrence);
  }

  public pruneCompletedThrough(
    cursor: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationOccurrenceClaimPruningResult> {
    this.pruneCallCount += 1;

    if (this.shouldFailPruning) {
      this.shouldFailPruning = false;
      this.interceptedCursor = cursor;
      return Promise.reject(this.failure);
    }

    return this.delegate.pruneCompletedThrough(cursor);
  }
}

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

function createProcessListExecutor(): Pm2ProcessListExecutor {
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

describe("file-backed scheduler claim-pruning failure recovery", () => {
  it("retries pruning without repeating the current interval service effect", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-scheduler-claim-pruning-recovery-"),
    );
    temporaryDirectories.push(directory);
    const overridePath = join(directory, "availability-overrides.json");
    const claimPath = join(directory, "reconciliation-occurrence-claims.json");
    const cursorPath = join(directory, "reconciliation-scheduler-cursor.json");
    const environment = createEnvironment();
    const initialCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: initialCompletedThrough,
      });
    const initialOccurrence = createOccurrence(
      "start",
      initialCompletedThrough,
    );
    const currentOccurrence = createOccurrence("stop", currentCompletedThrough);
    const pruningFailure = new Error("controlled claim pruning failure");
    const controlExecute = vi
      .fn<Pm2ServiceControlExecutor["execute"]>()
      .mockResolvedValue();
    const controlExecutor: Pm2ServiceControlExecutor = {
      execute: controlExecute,
    };

    const setupCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(
      setupCursorStore.advance(null, initialCursor),
    ).resolves.toEqual({
      kind: "advanced",
      cursor: initialCursor,
    });
    const setupClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(setupClaimStore.claim(initialOccurrence)).resolves.toEqual({
      kind: "claimed",
    });
    const setupOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    const expiredOverride = createServiceAvailabilityOverride(
      {
        kind: "keep_available",
        expiresAt: "2026-07-27T19:00:00.000Z",
      },
      new Date("2026-07-27T18:00:00.000Z"),
    );
    await setupOverrideStore.save(serviceId, expiredOverride);

    const persistedSetupCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(persistedSetupCursorStore.read()).resolves.toEqual(
      initialCursor,
    );

    const firstRealClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const failingClaimStore = new FailFirstPruneOccurrenceClaimStore(
      firstRealClaimStore,
      pruningFailure,
    );
    const firstComposition = createServiceManagement(environment, {
      clock: createClock(
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:31.000Z",
        "2026-07-27T20:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore:
        new FileServiceAvailabilityOverrideStore(overridePath),
      serviceAvailabilityReconciliationOccurrenceClaimStore: failingClaimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore:
        new FileServiceAvailabilityReconciliationSchedulerCursorStore(
          cursorPath,
        ),
      pm2ProcessListExecutor: createProcessListExecutor(),
      pm2ControlExecutor: controlExecutor,
    });

    await expect(
      firstComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute(),
    ).rejects.toBe(pruningFailure);
    expect(failingClaimStore.claimCallCount).toBe(1);
    expect(failingClaimStore.pruneCallCount).toBe(1);
    expect(failingClaimStore.interceptedCursor).toEqual(initialCursor);
    expect(controlExecute).toHaveBeenCalledExactlyOnceWith("stop", processId);

    const afterFailureCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const afterFailureClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const afterFailureOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    await expect(afterFailureCursorStore.read()).resolves.toEqual(
      initialCursor,
    );
    await expect(
      afterFailureClaimStore.claim(initialOccurrence),
    ).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(
      afterFailureClaimStore.claim(currentOccurrence),
    ).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(
      afterFailureOverrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();

    const retryClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const retryCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const retryComposition = createServiceManagement(environment, {
      clock: createClock(
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore:
        new FileServiceAvailabilityOverrideStore(overridePath),
      serviceAvailabilityReconciliationOccurrenceClaimStore: retryClaimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore: retryCursorStore,
      pm2ProcessListExecutor: createProcessListExecutor(),
      pm2ControlExecutor: controlExecutor,
    });

    const retryResult =
      await retryComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(retryResult.kind).toBe("advanced");
    if (retryResult.kind !== "advanced") {
      throw new Error("Expected reconstructed scheduler retry to advance");
    }
    expect(retryResult.cursor.completedThrough).toBe(currentCompletedThrough);
    expect(retryResult.report).toMatchObject([
      {
        kind: "completed",
        serviceId,
        occurrenceResults: [
          {
            kind: "completed",
            occurrence: currentOccurrence,
            result: { kind: "duplicate" },
          },
        ],
      },
    ]);
    expect(retryResult.pruningReport).toEqual([
      { kind: "no_override", serviceId },
    ]);
    expect(retryResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(Object.isFrozen(retryResult)).toBe(true);
    expect(controlExecute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(retryResult)).not.toContain(directory);

    const finalClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const finalCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const finalOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    await expect(finalClaimStore.claim(initialOccurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(finalClaimStore.claim(currentOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(finalCursorStore.read()).resolves.toEqual(retryResult.cursor);
    await expect(
      finalOverrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();
  });
});
