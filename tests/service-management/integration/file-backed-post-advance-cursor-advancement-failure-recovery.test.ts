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

class FailFirstCursorAdvancementStore implements ServiceAvailabilityReconciliationSchedulerCursorStore {
  public advanceCalls = 0;
  #hasFailed = false;

  public constructor(
    private readonly delegate: ServiceAvailabilityReconciliationSchedulerCursorStore,
    private readonly failure: Error,
  ) {}

  public read() {
    return this.delegate.read();
  }

  public advance(
    expected: ServiceAvailabilityReconciliationSchedulerCursor | null,
    next: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult> {
    this.advanceCalls += 1;

    if (!this.#hasFailed) {
      this.#hasFailed = true;
      return Promise.reject(this.failure);
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

describe("file-backed post-advance cursor-advancement failure recovery", () => {
  it("preserves committed maintenance and retries after cursor advancement rejects", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-post-advance-cursor-failure-"),
    );
    temporaryDirectories.push(directory);
    const environment = createEnvironment();
    const firstOccurrence = createOccurrence("start", t1);
    const secondOccurrence = createOccurrence("stop", t2);
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
    expect(firstOrchestrate.execute).toHaveBeenCalledExactlyOnceWith(
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

    const cursorFailure = new Error("controlled cursor advancement failure");
    const secondStores = createStores(directory);
    const failingCursorStore = new FailFirstCursorAdvancementStore(
      secondStores.cursorStore,
      cursorFailure,
    );
    const secondOrchestrate = createMockOrchestrate();
    const second = createServiceManagement(environment, {
      orchestrateRegisteredServiceControl: secondOrchestrate,
      clock: createClock(t2, 4),
      serviceAvailabilityOverrideStore: secondStores.overrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        secondStores.claimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore: failingCursorStore,
      pm2ProcessListExecutor: createProcessList("online"),
      pm2ControlExecutor: { execute: controlExecute },
    });

    await expect(
      second.runServiceAvailabilityReconciliationSchedulerCycle.execute(),
    ).rejects.toBe(cursorFailure);
    expect(failingCursorStore.advanceCalls).toBe(1);
    expect(secondOrchestrate.execute).toHaveBeenCalledExactlyOnceWith(
      "atlas-api",
      "stop",
      "scheduled",
    );

    const afterFailure = createStores(directory);
    await expect(afterFailure.cursorStore.read()).resolves.toEqual(
      firstResult.cursor,
    );
    await expect(
      afterFailure.overrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();

    const retryStores = createStores(directory);
    const retryOrchestrate = createMockOrchestrate();
    const retry = createServiceManagement(environment, {
      orchestrateRegisteredServiceControl: retryOrchestrate,
      clock: createClock(t2, 3),
      serviceAvailabilityOverrideStore: retryStores.overrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        retryStores.claimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore:
        retryStores.cursorStore,
      pm2ProcessListExecutor: createProcessList("online"),
      pm2ControlExecutor: { execute: controlExecute },
    });
    const retryResult =
      await retry.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(retryResult.kind).toBe("advanced");
    if (retryResult.kind !== "advanced") {
      throw new Error("Expected reconstructed retry to advance");
    }
    expect(retryResult.cursor.completedThrough).toBe(t2);
    expect(retryResult.occurrenceClaimPruningResult).toEqual({
      kind: "unchanged",
    });
    expect(retryResult.pruningReport).toEqual([
      { kind: "no_override", serviceId },
    ]);
    expect(retryResult.report).toMatchObject([
      {
        kind: "completed",
        serviceId,
        occurrenceResults: [
          {
            kind: "completed",
            occurrence: secondOccurrence,
            result: { kind: "duplicate" },
          },
        ],
      },
    ]);
    expect(retryOrchestrate.execute).not.toHaveBeenCalled();
    expect(Object.isFrozen(retryResult)).toBe(true);

    const finalStores = createStores(directory);
    await expect(finalStores.cursorStore.read()).resolves.toEqual(
      retryResult.cursor,
    );
    await expect(
      finalStores.overrideStore.findByServiceId(serviceId),
    ).resolves.toBeNull();
    await expect(
      finalStores.claimStore.claim(firstOccurrence),
    ).resolves.toEqual({ kind: "claimed" });
    await expect(
      finalStores.claimStore.claim(secondOccurrence),
    ).resolves.toEqual({ kind: "duplicate" });
  });
});
