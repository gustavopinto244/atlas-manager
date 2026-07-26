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

const temporaryDirectories: string[] = [];
const services = [
  { id: "service-a", externalResourceId: "service-a-pm2", processId: 42 },
  { id: "service-b", externalResourceId: "service-b-pm2", processId: 43 },
] as const;
const t0 = "2026-07-27T20:00:00.000Z";
const t1 = "2026-08-03T12:00:00.000Z";
const t2 = "2026-08-03T20:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createClock(target: string): Clock {
  const targetInstant = new Date(target);
  const values = [
    new Date(targetInstant.getTime() + 30_000),
    new Date(targetInstant.getTime() + 30_000),
    new Date(targetInstant.getTime() + 31_000),
    new Date(targetInstant.getTime() + 30_000),
    new Date(targetInstant.getTime() + 31_000),
    new Date(targetInstant.getTime() + 30_000),
  ];

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

function createProcessList(
  status: "online" | "stopped",
): Pm2ProcessListExecutor {
  return {
    execute: vi.fn<Pm2ProcessListExecutor["execute"]>().mockResolvedValue(
      JSON.stringify(
        services.map(({ externalResourceId, processId }) => ({
          name: externalResourceId,
          pm_id: processId,
          pm2_env: { status },
        })),
      ),
    ),
  };
}

function createOccurrence(
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

describe("file-backed post-advance occurrence claim cleanup", () => {
  it("preserves current claims and removes them on the next reconstructed interval", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-post-advance-claim-cleanup-"),
    );
    temporaryDirectories.push(directory);
    const overridePath = join(directory, "availability-overrides.json");
    const claimPath = join(directory, "reconciliation-occurrence-claims.json");
    const cursorPath = join(directory, "reconciliation-scheduler-cursor.json");
    const environment = createEnvironment();
    const firstOccurrences = services.map(({ id }) =>
      createOccurrence(id, "start", t1),
    );
    const secondOccurrences = services.map(({ id }) =>
      createOccurrence(id, "stop", t2),
    );
    const controlExecute = vi
      .fn<Pm2ServiceControlExecutor["execute"]>()
      .mockResolvedValue(undefined);
    const controlExecutor: Pm2ServiceControlExecutor = {
      execute: controlExecute,
    };
    const initialCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: t0,
      });

    const setupCursor =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    await expect(setupCursor.advance(null, initialCursor)).resolves.toEqual({
      kind: "advanced",
      cursor: initialCursor,
    });
    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(initialCursor);

    const first = createServiceManagement(environment, {
      clock: createClock(t1),
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
      pm2ProcessListExecutor: createProcessList("stopped"),
      pm2ControlExecutor: controlExecutor,
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
    expect(firstResult.pruningReport).toEqual([
      { kind: "no_override", serviceId: "service-a" },
      { kind: "no_override", serviceId: "service-b" },
    ]);
    expect(Object.isFrozen(firstResult)).toBe(true);

    const firstByService = new Map(
      firstResult.report.map((entry) => [entry.serviceId, entry]),
    );
    for (const [index, service] of services.entries()) {
      expect(firstByService.get(service.id)).toMatchObject({
        kind: "completed",
        occurrenceResults: [
          {
            kind: "completed",
            occurrence: firstOccurrences[index],
            result: { kind: "executed" },
          },
        ],
      });
    }
    expect(controlExecute).toHaveBeenCalledTimes(2);
    for (const service of services) {
      expect(controlExecute).toHaveBeenCalledWith("start", service.processId);
    }

    const afterFirstClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    for (const occurrence of firstOccurrences) {
      await expect(afterFirstClaimStore.claim(occurrence)).resolves.toEqual({
        kind: "duplicate",
      });
    }
    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(firstResult.cursor);

    const second = createServiceManagement(environment, {
      clock: createClock(t2),
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
      pm2ProcessListExecutor: createProcessList("online"),
      pm2ControlExecutor: controlExecutor,
    });
    const persistedFirstCursor =
      await new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read();
    expect(persistedFirstCursor).toEqual(firstResult.cursor);

    const secondResult =
      await second.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(secondResult.kind).toBe("advanced");
    if (secondResult.kind !== "advanced") {
      throw new Error("Expected second scheduler cycle to advance");
    }
    expect(secondResult.cursor.completedThrough).toBe(t2);
    expect(secondResult.occurrenceClaimPruningResult).toEqual({
      kind: "pruned",
    });
    expect(secondResult.pruningReport).toEqual([
      { kind: "no_override", serviceId: "service-a" },
      { kind: "no_override", serviceId: "service-b" },
    ]);
    expect(Object.isFrozen(secondResult)).toBe(true);

    const secondByService = new Map(
      secondResult.report.map((entry) => [entry.serviceId, entry]),
    );
    for (const [index, service] of services.entries()) {
      expect(secondByService.get(service.id)).toMatchObject({
        kind: "completed",
        occurrenceResults: [
          {
            kind: "completed",
            occurrence: secondOccurrences[index],
            result: { kind: "executed" },
          },
        ],
      });
    }
    expect(controlExecute).toHaveBeenCalledTimes(4);
    for (const service of services) {
      expect(controlExecute).toHaveBeenCalledWith("stop", service.processId);
    }

    const finalClaims =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    for (const occurrence of firstOccurrences) {
      await expect(finalClaims.claim(occurrence)).resolves.toEqual({
        kind: "claimed",
      });
    }
    for (const occurrence of secondOccurrences) {
      await expect(finalClaims.claim(occurrence)).resolves.toEqual({
        kind: "duplicate",
      });
    }
    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(secondResult.cursor);
  });
});
