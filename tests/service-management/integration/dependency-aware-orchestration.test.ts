import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Clock } from "../../../src/service-management/application/ports/clock.js";
import type { ServiceController } from "../../../src/service-management/application/ports/service-controller.js";
import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import type { ServiceControlOperation } from "../../../src/service-management/domain/registered-service-control-result.js";
import type { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import type { DockerContainerControlExecutor } from "../../../src/service-management/infrastructure/docker-container-control-executor.js";
import type { DockerContainerInspectExecutor } from "../../../src/service-management/infrastructure/docker-container-inspect-executor.js";
import type {
  DockerComposeProjectControlExecutor,
  DockerComposeProjectStatusExecutor,
} from "../../../src/service-management/infrastructure/docker-compose-executors.js";
import { FileServiceAvailabilityReconciliationOccurrenceClaimStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createClock(timestamp = "2026-07-27T12:00:00.000Z"): Clock {
  return { now: vi.fn(() => new Date(timestamp)) };
}

function createEnvironment(
  services: readonly Record<string, unknown>[],
): Readonly<Record<string, string | undefined>> {
  return { REGISTERED_SERVICES_JSON: JSON.stringify(services) };
}

function service(
  id: string,
  adapter: "mock" | "docker" | "docker-compose",
  dependencies: readonly string[] = [],
  availabilityPolicy: Record<string, unknown> = { mode: "always" },
): Record<string, unknown> {
  return {
    id,
    displayName: id,
    managementAdapter: adapter,
    externalResourceId: id,
    supportedOperations: ["readStatus", "start", "stop", "restart"],
    availabilityPolicy,
    dependencies,
    ...(adapter === "docker-compose"
      ? {
          managementConfiguration: {
            composeFile: "/srv/atlas/compose.yaml",
            projectDirectory: "/srv/atlas",
          },
        }
      : {}),
  };
}

function createDockerHarness(
  initialStates: Readonly<Record<string, "running" | "stopped">>,
  events: string[],
): {
  inspect: DockerContainerInspectExecutor;
  control: DockerContainerControlExecutor;
} {
  const states = new Map(Object.entries(initialStates));
  const inspect: DockerContainerInspectExecutor = {
    execute: vi.fn(async (target: string) => {
      const state = states.get(target) ?? "stopped";
      return JSON.stringify([
        {
          State: {
            Status: state === "running" ? "running" : "exited",
            StartedAt: "2026-07-27T11:00:00.000Z",
          },
          Config: { Image: "atlas/test:latest" },
        },
      ]);
    }),
  };
  const control: DockerContainerControlExecutor = {
    execute: vi.fn(
      async (operation: "start" | "stop" | "restart", target: string) => {
        events.push(`docker:${operation}:${target}`);
        states.set(target, operation === "stop" ? "stopped" : "running");
      },
    ),
  };
  return { inspect, control };
}

function createComposeHarness(
  initialState: "running" | "stopped",
  events: string[],
): {
  status: DockerComposeProjectStatusExecutor;
  control: DockerComposeProjectControlExecutor;
} {
  let state = initialState;
  return {
    status: {
      execute: vi.fn(async () =>
        JSON.stringify([
          {
            Name: "atlas-api",
            State: state === "running" ? "running" : "exited",
            ExitCode: 0,
          },
        ]),
      ),
    },
    control: {
      execute: vi.fn(async (operation) => {
        events.push(`compose:${operation}:atlas-api`);
        state = operation === "stop" ? "stopped" : "running";
      }),
    },
  };
}

describe("dependency-aware service orchestration integration", () => {
  it("starts Docker dependencies before a Docker Compose target", async () => {
    const events: string[] = [];
    const docker = createDockerHarness({ "atlas-postgres": "stopped" }, events);
    const compose = createComposeHarness("stopped", events);
    const capabilities = createServiceManagement(
      createEnvironment([
        service("atlas-postgres", "docker"),
        service("atlas-api", "docker-compose", ["atlas-postgres"]),
      ]),
      {
        clock: createClock(),
        dockerContainerInspectExecutor: docker.inspect,
        dockerContainerControlExecutor: docker.control,
        dockerComposeProjectStatusExecutor: compose.status,
        dockerComposeProjectControlExecutor: compose.control,
        serviceReadinessTimer: { sleep: vi.fn().mockResolvedValue(undefined) },
      },
    );

    const result =
      await capabilities.orchestrateRegisteredServiceControl.execute(
        "atlas-api",
        "start",
      );

    expect(result.successful).toBe(true);
    expect(events).toEqual([
      "docker:start:atlas-postgres",
      "compose:start:atlas-api",
    ]);
  });

  it("stops a reverse dependency chain without starting anything", async () => {
    const events: string[] = [];
    const controller: ServiceController = {
      execute: vi.fn(
        async (
          service: RegisteredService,
          operation: ServiceControlOperation,
        ) => {
          events.push(`${operation}:${service.id}`);
        },
      ),
    };
    const capabilities = createServiceManagement(
      createEnvironment([
        service("database", "mock"),
        service("api", "mock", ["database"]),
        service("worker", "mock", ["api"]),
      ]),
      {
        clock: createClock(),
        serviceController: controller,
        mockStatusConfiguration: [
          { externalResourceId: "database", state: "running" },
          { externalResourceId: "api", state: "running" },
          { externalResourceId: "worker", state: "running" },
        ],
        serviceReadinessTimer: { sleep: vi.fn().mockResolvedValue(undefined) },
      },
    );

    const result =
      await capabilities.orchestrateRegisteredServiceControl.execute(
        "database",
        "stop",
      );

    expect(result.successful).toBe(true);
    expect(events).toEqual(["stop:worker", "stop:api", "stop:database"]);
    expect(events.some((event) => event.startsWith("start:"))).toBe(false);
  });

  it("restarts a target and restores only active dependents after readiness", async () => {
    const events: string[] = [];
    const controller: ServiceController = {
      execute: vi.fn(
        async (
          service: RegisteredService,
          operation: ServiceControlOperation,
        ) => {
          events.push(`${operation}:${service.id}`);
        },
      ),
    };
    const capabilities = createServiceManagement(
      createEnvironment([
        service("database", "mock"),
        service("api", "mock", ["database"]),
        service("worker", "mock", ["api"]),
      ]),
      {
        clock: createClock(),
        serviceController: controller,
        mockStatusConfiguration: [
          { externalResourceId: "database", state: "running" },
          { externalResourceId: "api", state: "running" },
          { externalResourceId: "worker", state: "running" },
        ],
        serviceReadinessTimer: { sleep: vi.fn().mockResolvedValue(undefined) },
      },
    );

    const result =
      await capabilities.orchestrateRegisteredServiceControl.execute(
        "api",
        "restart",
      );

    expect(result.successful).toBe(true);
    expect(events).toEqual(["stop:worker", "restart:api", "start:worker"]);
    expect(events).not.toContain("restart:database");
  });

  it("reconstructs file-backed scheduler state for dependency start and later stop", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "atlas-dependency-recovery-"),
    );
    temporaryDirectories.push(directory);
    const cursorPath = join(directory, "cursor.json");
    const claimPath = join(directory, "claims.json");
    const cursorStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(cursorPath);
    const claimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    const t0 = "2026-07-27T08:00:00.000Z";
    const t1 = "2026-07-27T12:00:00.000Z";
    const t2 = "2026-07-27T20:00:00.000Z";
    const initialCursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create({
        completedThrough: t0,
      });
    await expect(
      cursorStore.advance(null, initialCursor),
    ).resolves.toMatchObject({
      kind: "advanced",
    });

    const environment = createEnvironment([
      service("atlas-postgres", "docker"),
      service("atlas-redis", "docker"),
      service(
        "atlas-api",
        "docker-compose",
        ["atlas-postgres", "atlas-redis"],
        {
          mode: "scheduled",
          timezone: "America/Sao_Paulo",
          windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
        },
      ),
    ]);

    const startEvents: string[] = [];
    const firstDocker = createDockerHarness(
      { "atlas-postgres": "stopped", "atlas-redis": "stopped" },
      startEvents,
    );
    const firstCompose = createComposeHarness("stopped", startEvents);
    const first = createServiceManagement(environment, {
      clock: createClock(t1),
      serviceAvailabilityReconciliationSchedulerCursorStore: cursorStore,
      serviceAvailabilityReconciliationOccurrenceClaimStore: claimStore,
      dockerContainerInspectExecutor: firstDocker.inspect,
      dockerContainerControlExecutor: firstDocker.control,
      dockerComposeProjectStatusExecutor: firstCompose.status,
      dockerComposeProjectControlExecutor: firstCompose.control,
      serviceReadinessTimer: { sleep: vi.fn().mockResolvedValue(undefined) },
    });
    const firstResult =
      await first.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(firstResult.kind).toBe("advanced");
    expect(startEvents).toEqual([
      "docker:start:atlas-postgres",
      "docker:start:atlas-redis",
      "compose:start:atlas-api",
    ]);
    const startOccurrence = ServiceAvailabilityReconciliationOccurrence.create({
      serviceId: "atlas-api",
      operation: "start",
      scheduledFor: t1,
    });
    await expect(claimStore.claim(startOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });

    const stopEvents: string[] = [];
    const secondDocker = createDockerHarness(
      { "atlas-postgres": "running", "atlas-redis": "running" },
      stopEvents,
    );
    const secondCompose = createComposeHarness("running", stopEvents);
    const second = createServiceManagement(environment, {
      clock: createClock(t2),
      serviceAvailabilityReconciliationSchedulerCursorStore:
        new FileServiceAvailabilityReconciliationSchedulerCursorStore(
          cursorPath,
        ),
      serviceAvailabilityReconciliationOccurrenceClaimStore:
        new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
          claimPath,
        ),
      dockerContainerInspectExecutor: secondDocker.inspect,
      dockerContainerControlExecutor: secondDocker.control,
      dockerComposeProjectStatusExecutor: secondCompose.status,
      dockerComposeProjectControlExecutor: secondCompose.control,
      serviceReadinessTimer: { sleep: vi.fn().mockResolvedValue(undefined) },
    });
    const secondResult =
      await second.runServiceAvailabilityReconciliationSchedulerCycle.execute();

    expect(secondResult.kind).toBe("advanced");
    expect(stopEvents).toEqual(["compose:stop:atlas-api"]);
    const stopOccurrence = ServiceAvailabilityReconciliationOccurrence.create({
      serviceId: "atlas-api",
      operation: "stop",
      scheduledFor: t2,
    });
    const finalClaimStore =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(claimPath);
    await expect(finalClaimStore.claim(startOccurrence)).resolves.toEqual({
      kind: "claimed",
    });
    await expect(finalClaimStore.claim(stopOccurrence)).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(
        cursorPath,
      ).read(),
    ).resolves.toMatchObject({ completedThrough: t2 });
  });
});
