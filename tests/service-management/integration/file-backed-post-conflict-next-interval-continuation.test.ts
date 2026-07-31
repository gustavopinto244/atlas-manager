import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type { ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult } from "../../../src/service-management/application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
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
const t0 = "2026-07-27T20:00:00.000Z";
const t1 = "2026-08-03T12:00:00.000Z";
const t2 = "2026-08-03T20:00:00.000Z";
const t3 = "2026-08-10T12:00:00.000Z";

class CompetingCursorAdvancementStore {
  public advanceCalls = 0;
  public competingAdvanceCalls = 0;
  #hasInjectedConflict = false;

  public constructor(
    private readonly delegate: FileServiceAvailabilityReconciliationSchedulerCursorStore,
    private readonly competingStore: FileServiceAvailabilityReconciliationSchedulerCursorStore,
    private readonly competingCursor: ServiceAvailabilityReconciliationSchedulerCursor,
  ) {}

  public read() {
    return this.delegate.read();
  }

  public advance(
    expected: ServiceAvailabilityReconciliationSchedulerCursor | null,
    next: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult> {
    this.advanceCalls += 1;

    if (
      !this.#hasInjectedConflict &&
      expected !== null &&
      expected.completedThrough === t1 &&
      next.completedThrough === t2
    ) {
      this.#hasInjectedConflict = true;
      this.competingAdvanceCalls += 1;
      return this.competingStore
        .advance(expected, this.competingCursor)
        .then(() => this.delegate.advance(expected, next));
    }

    return this.delegate.advance(expected, next);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createClock(target: string, calls: number): Clock {
  const targetInstant = new Date(target);
  const values = Array.from(
    { length: calls },
    (_, index) =>
      new Date(targetInstant.getTime() + 30_000 + (index === 2 ? 1_000 : 0)),
  );

  return {
    now: vi.fn(() => {
      const value = values.shift();

      if (value === undefined) {
        throw new Error("Controlled integration clock was exhausted");
      }

      return value;
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

function createProcessList(
  status: "online" | "stopped",
): Pm2ProcessListExecutor {
  return {
    execute: vi.fn<Pm2ProcessListExecutor["execute"]>().mockResolvedValue(
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

function createStores(directory: string) {
  return {
    overrideStore: new FileServiceAvailabilityOverrideStore(
      join(directory, "availability-overrides.json"),
    ),
    claimStore: new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      join(directory, "reconciliation-occurrence-claims.json"),
    ),
    cursorStore: new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      join(directory, "reconciliation-scheduler-cursor.json"),
    ),
  };
}

describe("file-backed post-conflict next-interval continuation", () => {
  it("continues with next interval after cursor conflict", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-post-conflict-next-interval-"),
    );
    temporaryDirectories.push(directory);
    const environment = createEnvironment();
    const firstOccurrence = createOccurrence("start", t1);
    const secondOccurrence = createOccurrence("stop", t2);
    const thirdOccurrence = createOccurrence("start", t3);
    const initialCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: t0,
      });
    const controlExecute = vi
      .fn<Pm2ServiceControlExecutor["execute"]>()
      .mockResolvedValue(undefined);
    const stores = createStores(directory);

    await expect(
      stores.cursorStore.advance(null, initialCursor),
    ).resolves.toEqual({ kind: "advanced", cursor: initialCursor });

    const afterSetup = createStores(directory);
    await expect(afterSetup.cursorStore.read()).resolves.toEqual(initialCursor);

    const firstOrchestrate = createMockOrchestrate();
    const first = createServiceManagement(environment, {
      orchestrateRegisteredServiceControl: firstOrchestrate,
      clock: createClock(t1, 4),
      serviceAvailabilityOverrideStore: stores.overrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore: stores.claimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore: stores.cursorStore,
      pm2ProcessListExecutor: createProcessList("stopped"),
      pm2ControlExecutor: { execute: controlExecute },
    });
    const firstResult =
      await first.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(firstResult.kind).toBe("advanced");
    if (firstResult.kind !== "advanced") {
      throw new Error("Expected first scheduler cycle to advance");
    }
    expect(firstResult.cursor.completedThrough).toBe(t1);
    expect(firstResult.occurrenceClaimPruningResult).toEqual({
      kind: "unchanged",
    });
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
    expect(firstOrchestrate.execute).toHaveBeenCalledTimes(1);
    expect(firstOrchestrate.execute).toHaveBeenCalledWith(
      "atlas-api",
      "start",
      "scheduled",
    );
    expect(Object.isFrozen(firstResult)).toBe(true);

    const afterFirst = createStores(directory);
    await expect(afterFirst.cursorStore.read()).resolves.toEqual(
      firstResult.cursor,
    );
    await expect(afterFirst.claimStore.claim(firstOccurrence)).resolves.toEqual(
      { kind: "duplicate" },
    );

    const expiredOverride = createServiceAvailabilityOverride(
      { kind: "keep_available", expiresAt: "2026-08-03T11:00:00.000Z" },
      new Date("2026-08-03T10:00:00.000Z"),
    );
    await afterFirst.overrideStore.save(serviceId, expiredOverride);
    await expect(
      new FileServiceAvailabilityOverrideStore(
        join(directory, "availability-overrides.json"),
      ).findByServiceId(serviceId),
    ).resolves.toEqual(expiredOverride);

    const secondStores = createStores(directory);
    const competingCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: t2,
      });
    const competingCursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        join(directory, "reconciliation-scheduler-cursor.json"),
      );
    const conflictWrapper = new CompetingCursorAdvancementStore(
      secondStores.cursorStore,
      competingCursorStore,
      competingCursor,
    );
    const secondOrchestrate = createMockOrchestrate();
    const second = createServiceManagement(environment, {
      orchestrateRegisteredServiceControl: secondOrchestrate,
      clock: createClock(t2, 4),
      serviceAvailabilityOverrideStore: secondStores.overrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        secondStores.claimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore: conflictWrapper,
      pm2ProcessListExecutor: createProcessList("online"),
      pm2ControlExecutor: { execute: controlExecute },
    });
    const secondResult =
      await second.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(secondResult.kind).toBe("conflict");
    if (secondResult.kind !== "conflict") {
      throw new Error("Expected second scheduler cycle to return conflict");
    }
    expect(secondResult.cursor).not.toBeNull();
    if (secondResult.cursor === null) {
      throw new Error("Expected conflict result to have a cursor");
    }
    expect(secondResult.cursor.completedThrough).toBe(t2);
    expect(secondResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(secondResult.pruningReport).toEqual([
      { kind: "removed", serviceId },
    ]);
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
    expect(secondOrchestrate.execute).toHaveBeenCalledTimes(1);
    expect(secondOrchestrate.execute).toHaveBeenCalledWith(
      "atlas-api",
      "stop",
      "scheduled",
    );
    expect(conflictWrapper.competingAdvanceCalls).toBe(1);
    expect(Object.isFrozen(secondResult)).toBe(true);

    const afterConflict = createStores(directory);
    await expect(afterConflict.cursorStore.read()).resolves.toEqual(
      secondResult.cursor,
    );
    await expect(
      afterConflict.overrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();

    const thirdStores = createStores(directory);
    const thirdOrchestrate = createMockOrchestrate();
    const third = createServiceManagement(environment, {
      orchestrateRegisteredServiceControl: thirdOrchestrate,
      clock: createClock(t3, 4),
      serviceAvailabilityOverrideStore: thirdStores.overrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        thirdStores.claimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore:
        thirdStores.cursorStore,
      pm2ProcessListExecutor: createProcessList("stopped"),
      pm2ControlExecutor: { execute: controlExecute },
    });
    const thirdResult =
      await third.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(thirdResult.kind).toBe("advanced");
    if (thirdResult.kind !== "advanced") {
      throw new Error("Expected third scheduler cycle to advance");
    }
    expect(thirdResult.cursor.completedThrough).toBe(t3);
    expect(thirdResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(thirdResult.pruningReport).toEqual([
      { kind: "no_override", serviceId },
    ]);
    expect(thirdResult.report).toMatchObject([
      {
        kind: "completed",
        serviceId,
        occurrenceResults: [
          {
            kind: "completed",
            occurrence: thirdOccurrence,
            result: { kind: "executed" },
          },
        ],
      },
    ]);
    expect(thirdOrchestrate.execute).toHaveBeenCalledTimes(1);
    expect(thirdOrchestrate.execute).toHaveBeenCalledWith(
      "atlas-api",
      "start",
      "scheduled",
    );
    expect(Object.isFrozen(thirdResult)).toBe(true);

    const finalStores = createStores(directory);
    await expect(finalStores.cursorStore.read()).resolves.toEqual(
      thirdResult.cursor,
    );
    await expect(
      finalStores.overrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();
    await expect(
      finalStores.claimStore.claim(firstOccurrence),
    ).resolves.toEqual({ kind: "claimed" });
    await expect(
      finalStores.claimStore.claim(secondOccurrence),
    ).resolves.toEqual({ kind: "claimed" });
    await expect(
      finalStores.claimStore.claim(thirdOccurrence),
    ).resolves.toEqual({ kind: "duplicate" });
  });
});
