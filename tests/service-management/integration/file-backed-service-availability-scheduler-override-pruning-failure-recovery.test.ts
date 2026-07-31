import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type {
  ServiceAvailabilityOverrideConditionalRemovalResult,
  ServiceAvailabilityOverrideStore,
} from "../../../src/service-management/application/ports/service-availability-override-store.js";
import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import { FileServiceAvailabilityOverrideStore } from "../../../src/service-management/infrastructure/file-service-availability-override-store.js";
import { FileServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import type { Pm2ServiceControlExecutor } from "../../../src/service-management/infrastructure/pm2-service-control-executor.js";
import { createMockOrchestrate } from "../../test-helpers/mock-orchestrate.js";
import {
  createServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../../src/service-scheduling/domain/service-availability-override.js";

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

class FailFirstExpiredOverrideRemovalStore implements ServiceAvailabilityOverrideStore {
  public calls = 0;
  private fail = true;

  public constructor(
    private readonly delegate: ServiceAvailabilityOverrideStore,
    private readonly error: Error,
  ) {}

  public findByServiceId(serviceId: string) {
    return this.delegate.findByServiceId(serviceId);
  }

  public save(serviceId: string, override: ServiceAvailabilityOverride) {
    return this.delegate.save(serviceId, override);
  }

  public removeByServiceId(serviceId: string) {
    return this.delegate.removeByServiceId(serviceId);
  }

  public removeByServiceIdIfMatches(
    serviceId: string,
    expectedOverride: ServiceAvailabilityOverride,
  ): Promise<ServiceAvailabilityOverrideConditionalRemovalResult> {
    this.calls += 1;
    if (this.fail) {
      this.fail = false;
      return Promise.reject(this.error);
    }
    return this.delegate.removeByServiceIdIfMatches(
      serviceId,
      expectedOverride,
    );
  }
}

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

describe("file-backed override-pruning failure recovery", () => {
  it("preserves state and retries maintenance after reconstruction", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-override-pruning-recovery-"),
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
    const expired = createServiceAvailabilityOverride(
      { kind: "keep_available", expiresAt: "2026-07-27T19:00:00.000Z" },
      new Date("2026-07-27T18:00:00.000Z"),
    );
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
    await new FileServiceAvailabilityOverrideStore(overridePath).save(
      serviceId,
      expired,
    );

    const removalError = new Error("override removal failure");
    const controlExecute = vi
      .fn<Pm2ServiceControlExecutor["execute"]>()
      .mockResolvedValue();
    const firstOverrideStore = new FailFirstExpiredOverrideRemovalStore(
      new FileServiceAvailabilityOverrideStore(overridePath),
      removalError,
    );
    const firstOrchestrate = createMockOrchestrate();
    const first = createServiceManagement(environment(), {
      orchestrateRegisteredServiceControl: firstOrchestrate,
      clock: clock(
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:30.000Z",
        "2026-07-27T20:00:31.000Z",
        "2026-07-27T20:00:30.000Z",
      ),
      serviceAvailabilityOverrideStore: firstOverrideStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
          claimPath,
        ),
      serviceAvailabilityReconciliationSchedulerCursorStore:
        new FileServiceAvailabilityReconciliationSchedulerCursorStore(
          cursorPath,
        ),
      pm2ProcessListExecutor: processList(),
      pm2ControlExecutor: { execute: controlExecute },
    });

    const failed =
      await first.runServiceAvailabilityReconciliationSchedulerCycle.execute();
    expect(failed.kind).toBe("incomplete");
    if (failed.kind !== "incomplete")
      throw new Error("expected incomplete cycle");
    expect(failed.occurrenceClaimPruningResult).toBeNull();
    expect(failed.pruningReport).toEqual([
      { kind: "failed", serviceId, error: removalError },
    ]);
    expect(firstOverrideStore.calls).toBe(1);
    expect(firstOrchestrate.execute).toHaveBeenCalledTimes(1);
    expect(firstOrchestrate.execute).toHaveBeenCalledWith(
      "atlas-api",
      "stop",
      "scheduled",
    );

    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toEqual(initialCursor);
    const afterFailureOverride = new FileServiceAvailabilityOverrideStore(
      overridePath,
    );
    await expect(
      afterFailureOverride.findByServiceId(serviceId),
    ).resolves.toEqual(expired);
    const afterFailureClaims =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(afterFailureClaims.claim(historical)).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(afterFailureClaims.claim(current)).resolves.toEqual({
      kind: "duplicate",
    });

    const retryOrchestrate = createMockOrchestrate();
    const retry = createServiceManagement(environment(), {
      orchestrateRegisteredServiceControl: retryOrchestrate,
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
      pm2ControlExecutor: { execute: controlExecute },
    });
    const result =
      await retry.runServiceAvailabilityReconciliationSchedulerCycle.execute();
    expect(result.kind).toBe("advanced");
    if (result.kind !== "advanced")
      throw new Error("expected retry to advance");
    expect(result.cursor.completedThrough).toBe(t1);
    expect(result.report).toMatchObject([
      {
        occurrenceResults: [
          { occurrence: current, result: { kind: "duplicate" } },
        ],
      },
    ]);
    expect(result.pruningReport).toEqual([{ kind: "removed", serviceId }]);
    expect(result.occurrenceClaimPruningResult).toEqual({ kind: "pruned" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(retryOrchestrate.execute).not.toHaveBeenCalled();

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
    ).resolves.toEqual(result.cursor);
  });
});
