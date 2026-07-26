import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type {
  ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult,
  ServiceAvailabilityReconciliationSchedulerCursorStore,
} from "../../../src/service-management/application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import type { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import { FileServiceAvailabilityOverrideStore } from "../../../src/service-management/infrastructure/file-service-availability-override-store.js";
import { FileServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import type { Pm2ServiceControlExecutor } from "../../../src/service-management/infrastructure/pm2-service-control-executor.js";

const temporaryDirectories: string[] = [];
const serviceId = "atlas-api";
const externalResourceId = "atlas-api-pm2";
const processId = 42;
const firstCompletedThrough = "2026-07-27T12:00:00.000Z";
const secondCompletedThrough = "2026-07-27T20:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class FailFirstAdvanceSchedulerCursorStore implements ServiceAvailabilityReconciliationSchedulerCursorStore {
  private shouldFailAdvance = true;

  public constructor(
    private readonly delegate: ServiceAvailabilityReconciliationSchedulerCursorStore,
    private readonly failure: Error,
  ) {}

  public read(): Promise<ServiceAvailabilityReconciliationSchedulerCursor | null> {
    return this.delegate.read();
  }

  public advance(
    expected: ServiceAvailabilityReconciliationSchedulerCursor | null,
    next: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult> {
    if (this.shouldFailAdvance) {
      this.shouldFailAdvance = false;
      return Promise.reject(this.failure);
    }

    return this.delegate.advance(expected, next);
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

function createProcessListExecutor(
  status: "online" | "stopped",
): Pm2ProcessListExecutor {
  return {
    execute: vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          name: externalResourceId,
          pm_id: processId,
          pm2_env: { status },
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

describe("file-backed service availability scheduler retry safety", () => {
  it("prevents a repeated service effect after reconstruction when cursor advancement failed", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-scheduler-retry-safety-"),
    );
    temporaryDirectories.push(directory);
    const overridePath = join(directory, "availability-overrides.json");
    const claimPath = join(directory, "reconciliation-occurrence-claims.json");
    const cursorPath = join(directory, "reconciliation-scheduler-cursor.json");
    const environment = createEnvironment();
    const firstOccurrence = createOccurrence("start", firstCompletedThrough);
    const secondOccurrence = createOccurrence("stop", secondCompletedThrough);
    const advanceFailure = new Error("controlled cursor advancement failure");
    const controlExecute = vi
      .fn<Pm2ServiceControlExecutor["execute"]>()
      .mockResolvedValue();
    const controlExecutor: Pm2ServiceControlExecutor = {
      execute: controlExecute,
    };

    const firstCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const firstComposition = createServiceManagement(environment, {
      clock: createClock(
        "2026-07-27T12:00:30.000Z",
        "2026-07-27T12:00:30.000Z",
        "2026-07-27T12:00:31.000Z",
        "2026-07-27T12:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore:
        new FileServiceAvailabilityOverrideStore(overridePath),
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
          claimPath,
        ),
      serviceAvailabilityReconciliationSchedulerCursorStore:
        new FailFirstAdvanceSchedulerCursorStore(
          firstCursorStore,
          advanceFailure,
        ),
      pm2ProcessListExecutor: createProcessListExecutor("stopped"),
      pm2ControlExecutor: controlExecutor,
    });

    await expect(firstCursorStore.read()).resolves.toBeNull();
    await expect(
      firstComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute(),
    ).rejects.toBe(advanceFailure);
    expect(controlExecute).toHaveBeenCalledExactlyOnceWith("start", processId);

    const afterFailureCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const afterFailureClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(afterFailureCursorStore.read()).resolves.toBeNull();
    await expect(
      afterFailureClaimStore.claim(firstOccurrence),
    ).resolves.toEqual({
      kind: "duplicate",
    });

    const retryCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const retryClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const retryComposition = createServiceManagement(environment, {
      clock: createClock(
        "2026-07-27T12:00:30.000Z",
        "2026-07-27T12:00:30.000Z",
        "2026-07-27T12:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore:
        new FileServiceAvailabilityOverrideStore(overridePath),
      serviceAvailabilityReconciliationOccurrenceClaimStore: retryClaimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore: retryCursorStore,
      pm2ProcessListExecutor: createProcessListExecutor("stopped"),
      pm2ControlExecutor: controlExecutor,
    });

    const retryResult =
      await retryComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(retryResult.kind).toBe("advanced");
    if (retryResult.kind !== "advanced") {
      throw new Error("Expected retried scheduler cycle to advance");
    }
    expect(retryResult.cursor.completedThrough).toBe(firstCompletedThrough);
    expect(retryResult.report).toMatchObject([
      {
        kind: "completed",
        serviceId,
        occurrenceResults: [
          {
            kind: "completed",
            occurrence: firstOccurrence,
            result: { kind: "duplicate" },
          },
        ],
      },
    ]);
    expect(retryResult.occurrenceClaimPruningResult).toEqual({
      kind: "no_cursor",
    });
    expect(Object.isFrozen(retryResult)).toBe(true);
    expect(controlExecute).toHaveBeenCalledTimes(1);

    const afterRetryCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const afterRetryClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(afterRetryCursorStore.read()).resolves.toEqual(
      retryResult.cursor,
    );
    await expect(afterRetryClaimStore.claim(firstOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });

    const laterCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(laterCursorStore.read()).resolves.toEqual(retryResult.cursor);
    const laterComposition = createServiceManagement(environment, {
      clock: createClock(
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:31.000Z",
        "2026-07-27T20:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore:
        new FileServiceAvailabilityOverrideStore(overridePath),
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
          claimPath,
        ),
      serviceAvailabilityReconciliationSchedulerCursorStore: laterCursorStore,
      pm2ProcessListExecutor: createProcessListExecutor("online"),
      pm2ControlExecutor: controlExecutor,
    });

    const laterResult =
      await laterComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(laterResult.kind).toBe("advanced");
    if (laterResult.kind !== "advanced") {
      throw new Error("Expected later scheduler cycle to advance");
    }
    expect(laterResult.cursor.completedThrough).toBe(secondCompletedThrough);
    expect(laterResult.report).toMatchObject([
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
    expect(laterResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(Object.isFrozen(laterResult)).toBe(true);
    expect(controlExecute).toHaveBeenCalledTimes(2);
    expect(controlExecute).toHaveBeenLastCalledWith("stop", processId);
    expect(JSON.stringify(retryResult)).not.toContain(directory);
    expect(JSON.stringify(laterResult)).not.toContain(directory);

    const finalClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const finalCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(finalClaimStore.claim(firstOccurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(finalClaimStore.claim(secondOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(finalCursorStore.read()).resolves.toEqual(laterResult.cursor);
  });
});
