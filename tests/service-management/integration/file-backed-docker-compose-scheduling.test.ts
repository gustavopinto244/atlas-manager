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
import type { DockerComposeProjectStatusExecutor } from "../../../src/service-management/infrastructure/docker-compose-executors.js";
import type { DockerComposeProjectControlExecutor } from "../../../src/service-management/infrastructure/docker-compose-executors.js";

const temporaryDirectories: string[] = [];
const serviceId = "atlas-stack";
const projectName = "atlas-stack";
const composeFile = "/srv/atlas/compose.yaml";
const projectDirectory = "/srv/atlas";
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
        displayName: "Atlas Stack",
        managementAdapter: "docker-compose",
        externalResourceId: projectName,
        supportedOperations: ["readStatus", "start", "stop"],
        availabilityPolicy: {
          mode: "scheduled",
          timezone: "America/Sao_Paulo",
          windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
        },
        managementConfiguration: {
          composeFile,
          projectDirectory,
        },
      },
    ]),
  };
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

describe("file-backed docker compose scheduling", () => {
  it("processes scheduled start and stop across reconstructed intervals", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-compose-file-backed-"),
    );
    temporaryDirectories.push(directory);
    const environment = createEnvironment();
    const firstOccurrence = createOccurrence("start", t1);
    const secondOccurrence = createOccurrence("stop", t2);
    const initialCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: t0,
      });
    const stores = createStores(directory);

    await expect(
      stores.cursorStore.advance(null, initialCursor),
    ).resolves.toEqual({ kind: "advanced", cursor: initialCursor });

    const afterSetup = createStores(directory);
    await expect(afterSetup.cursorStore.read()).resolves.toEqual(initialCursor);

    const statusExecutor1: DockerComposeProjectStatusExecutor = {
      execute: vi.fn().mockResolvedValue(
        JSON.stringify([
          { Name: "api", State: "exited", ExitCode: 0 },
          { Name: "db", State: "exited", ExitCode: 0 },
        ]),
      ),
    };
    const controlExecutor1: DockerComposeProjectControlExecutor = {
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const first = createServiceManagement(environment, {
      clock: createClock(t1, 4),
      serviceAvailabilityOverrideStore: stores.overrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore: stores.claimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore: stores.cursorStore,
      dockerComposeProjectStatusExecutor: statusExecutor1,
      dockerComposeProjectControlExecutor: controlExecutor1,
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
    /* eslint-disable-next-line @typescript-eslint/unbound-method */
    expect(controlExecutor1.execute).toHaveBeenCalledExactlyOnceWith(
      "start",
      projectName,
      projectDirectory,
      composeFile,
    );
    expect(Object.isFrozen(firstResult)).toBe(true);

    const afterFirst = createStores(directory);
    await expect(afterFirst.cursorStore.read()).resolves.toEqual(
      firstResult.cursor,
    );
    await expect(afterFirst.claimStore.claim(firstOccurrence)).resolves.toEqual(
      { kind: "duplicate" },
    );

    const statusExecutor2: DockerComposeProjectStatusExecutor = {
      execute: vi.fn().mockResolvedValue(
        JSON.stringify([
          { Name: "api", State: "running", ExitCode: 0 },
          { Name: "db", State: "running", ExitCode: 0 },
        ]),
      ),
    };
    const controlExecutor2: DockerComposeProjectControlExecutor = {
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const secondStores = createStores(directory);
    const second = createServiceManagement(environment, {
      clock: createClock(t2, 4),
      serviceAvailabilityOverrideStore: secondStores.overrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        secondStores.claimStore,
      serviceAvailabilityReconciliationSchedulerCursorStore:
        secondStores.cursorStore,
      dockerComposeProjectStatusExecutor: statusExecutor2,
      dockerComposeProjectControlExecutor: controlExecutor2,
    });
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
    /* eslint-disable-next-line @typescript-eslint/unbound-method */
    expect(controlExecutor2.execute).toHaveBeenCalledExactlyOnceWith(
      "stop",
      projectName,
      projectDirectory,
      composeFile,
    );
    expect(Object.isFrozen(secondResult)).toBe(true);

    const finalStores = createStores(directory);
    await expect(finalStores.cursorStore.read()).resolves.toEqual(
      secondResult.cursor,
    );
    await expect(
      finalStores.claimStore.claim(firstOccurrence),
    ).resolves.toEqual({ kind: "claimed" });
    await expect(
      finalStores.claimStore.claim(secondOccurrence),
    ).resolves.toEqual({ kind: "duplicate" });
  });
});
