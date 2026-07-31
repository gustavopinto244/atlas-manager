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
import { createServiceAvailabilityOverride } from "../../../src/service-scheduling/domain/service-availability-override.js";
import { createMockOrchestrate } from "../../test-helpers/mock-orchestrate.js";

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

class AdvanceCompetingCursorBeforeFirstAdvance implements ServiceAvailabilityReconciliationSchedulerCursorStore {
  public advanceCallCount = 0;
  public interceptedExpected:
    ServiceAvailabilityReconciliationSchedulerCursor | null | undefined;
  public interceptedNext:
    ServiceAvailabilityReconciliationSchedulerCursor | undefined;
  public competingResult:
    ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult | undefined;
  public delegatedResult:
    ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult | undefined;

  public constructor(
    private readonly delegate: ServiceAvailabilityReconciliationSchedulerCursorStore,
    private readonly competitor: ServiceAvailabilityReconciliationSchedulerCursorStore,
  ) {}

  public read(): Promise<ServiceAvailabilityReconciliationSchedulerCursor | null> {
    return this.delegate.read();
  }

  public async advance(
    expected: ServiceAvailabilityReconciliationSchedulerCursor | null,
    next: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult> {
    this.advanceCallCount += 1;

    if (this.advanceCallCount === 1) {
      this.interceptedExpected = expected;
      this.interceptedNext = next;
      this.competingResult = await this.competitor.advance(expected, next);

      if (this.competingResult.kind !== "advanced") {
        throw new Error("Expected competing cursor advancement to succeed");
      }
    }

    this.delegatedResult = await this.delegate.advance(expected, next);
    return this.delegatedResult;
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
): Pm2ProcessListExecutor & {
  readonly execute: ReturnType<typeof vi.fn<Pm2ProcessListExecutor["execute"]>>;
} {
  const execute = vi.fn<Pm2ProcessListExecutor["execute"]>().mockResolvedValue(
    JSON.stringify([
      {
        name: externalResourceId,
        pm_id: processId,
        pm2_env: { status },
      },
    ]),
  );

  return { execute };
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

describe("file-backed service availability scheduler conflict safety", () => {
  it("preserves committed effects and authoritative state across a cursor conflict and reconstruction", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-scheduler-conflict-safety-"),
    );
    temporaryDirectories.push(directory);
    const overridePath = join(directory, "availability-overrides.json");
    const claimPath = join(directory, "reconciliation-occurrence-claims.json");
    const cursorPath = join(directory, "reconciliation-scheduler-cursor.json");
    const environment = createEnvironment();
    const firstOccurrence = createOccurrence("start", firstCompletedThrough);
    const secondOccurrence = createOccurrence("stop", secondCompletedThrough);
    const controlExecute = vi
      .fn<Pm2ServiceControlExecutor["execute"]>()
      .mockResolvedValue();
    const controlExecutor: Pm2ServiceControlExecutor = {
      execute: controlExecute,
    };

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

    const schedulerCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const competingCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const conflictStore = new AdvanceCompetingCursorBeforeFirstAdvance(
      schedulerCursorStore,
      competingCursorStore,
    );
    const firstOrchestrate = createMockOrchestrate();
    const firstComposition = createServiceManagement(environment, {
      orchestrateRegisteredServiceControl: firstOrchestrate,
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
      serviceAvailabilityReconciliationSchedulerCursorStore: conflictStore,
      pm2ProcessListExecutor: createProcessListExecutor("stopped"),
      pm2ControlExecutor: controlExecutor,
    });

    await expect(schedulerCursorStore.read()).resolves.toBeNull();

    const conflictResult =
      await firstComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(conflictResult.kind).toBe("conflict");
    if (conflictResult.kind !== "conflict") {
      throw new Error("Expected first scheduler cycle to return a conflict");
    }
    expect(conflictStore.advanceCallCount).toBe(1);
    expect(conflictStore.interceptedExpected).toBeNull();
    expect(conflictStore.interceptedNext?.completedThrough).toBe(
      firstCompletedThrough,
    );
    expect(conflictStore.competingResult).toEqual({
      kind: "advanced",
      cursor: conflictStore.interceptedNext,
    });
    expect(conflictStore.delegatedResult?.kind).toBe("conflict");
    if (conflictStore.delegatedResult?.kind !== "conflict") {
      throw new Error("Expected delegated cursor advancement to conflict");
    }
    expect(conflictResult.cursor).toBe(conflictStore.delegatedResult.cursor);
    expect(conflictResult.cursor).toEqual(conflictStore.interceptedNext);
    expect(conflictResult.report).toMatchObject([
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
    expect(conflictResult.pruningReport).toEqual([
      { kind: "removed", serviceId },
    ]);
    expect(conflictResult.occurrenceClaimPruningResult).toEqual({
      kind: "no_cursor",
    });
    expect(Object.isFrozen(conflictResult)).toBe(true);
    expect(firstOrchestrate.execute).toHaveBeenCalledTimes(1);
    expect(firstOrchestrate.execute).toHaveBeenCalledWith(
      "atlas-api",
      "start",
      "scheduled",
    );
    expect(JSON.stringify(conflictResult)).not.toContain(directory);

    const afterConflictOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    const afterConflictClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const afterConflictCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(
      afterConflictOverrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();
    await expect(afterConflictCursorStore.read()).resolves.toEqual(
      conflictResult.cursor,
    );
    await expect(
      afterConflictClaimStore.claim(firstOccurrence),
    ).resolves.toEqual({
      kind: "duplicate",
    });

    const idleProcessListExecutor = createProcessListExecutor("stopped");
    const idleCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const idleOrchestrate = createMockOrchestrate();
    const idleComposition = createServiceManagement(environment, {
      orchestrateRegisteredServiceControl: idleOrchestrate,
      clock: createClock("2026-07-27T12:00:30.000Z"),
      serviceAvailabilityOverrideStore:
        new FileServiceAvailabilityOverrideStore(overridePath),
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
          claimPath,
        ),
      serviceAvailabilityReconciliationSchedulerCursorStore: idleCursorStore,
      pm2ProcessListExecutor: idleProcessListExecutor,
      pm2ControlExecutor: controlExecutor,
    });

    const idleResult =
      await idleComposition.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(idleResult).toEqual({
      kind: "idle",
      cursor: conflictResult.cursor,
    });
    expect(Object.keys(idleResult)).toEqual(["kind", "cursor"]);
    expect(Object.isFrozen(idleResult)).toBe(true);
    expect(idleProcessListExecutor.execute).not.toHaveBeenCalled();
    expect(idleOrchestrate.execute).not.toHaveBeenCalled();

    const afterIdleOverrideStore = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    const afterIdleClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(
      afterIdleOverrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();
    await expect(afterIdleClaimStore.claim(firstOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });

    const laterCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(laterCursorStore.read()).resolves.toEqual(
      conflictResult.cursor,
    );
    const laterOrchestrate = createMockOrchestrate();
    const laterComposition = createServiceManagement(environment, {
      orchestrateRegisteredServiceControl: laterOrchestrate,
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
    expect(laterResult.pruningReport).toEqual([
      { kind: "no_override", serviceId },
    ]);
    expect(laterResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(Object.isFrozen(laterResult)).toBe(true);
    expect(laterOrchestrate.execute).toHaveBeenCalledTimes(1);
    expect(laterOrchestrate.execute).toHaveBeenCalledWith(
      "atlas-api",
      "stop",
      "scheduled",
    );
    expect(JSON.stringify(laterResult)).not.toContain(directory);

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
    await expect(finalClaimStore.claim(firstOccurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(finalClaimStore.claim(secondOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(finalCursorStore.read()).resolves.toEqual(laterResult.cursor);
  });
});
