/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import {
  RuntimeReadinessReader,
  DockerHealthReadinessReader,
  ComposeHealthReadinessReader,
  createDispatchingReadinessReader,
  NodeServiceReadinessTimer,
} from "../../../src/service-management/infrastructure/readiness-infrastructure.js";
import type { ServiceStatusReader } from "../../../src/service-management/application/ports/service-status-reader.js";
import type { DockerContainerInspectExecutor } from "../../../src/service-management/infrastructure/docker-container-inspect-executor.js";
import type { DockerComposeProjectStatusExecutor } from "../../../src/service-management/infrastructure/docker-compose-executors.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  calculateComposeAggregateHealthState,
  type ComposeProjectService,
} from "../../../src/service-management/domain/compose-project.js";

const clock = { now: () => new Date("2026-07-27T12:00:00.000Z") };

function createDockerService(mode: "runtime" | "health" = "health") {
  return RegisteredService.create({
    id: "docker-service",
    displayName: "Docker Service",
    managementAdapter: "docker",
    externalResourceId: "container",
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "manual" },
    readinessPolicy: { mode },
  });
}

function createComposeService(mode: "runtime" | "health" = "health") {
  return RegisteredService.create({
    id: "compose-service",
    displayName: "Compose Service",
    managementAdapter: "docker-compose",
    externalResourceId: "project",
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "manual" },
    managementConfiguration: {
      composeFile: "/srv/project/compose.yaml",
      projectDirectory: "/srv/project",
    },
    readinessPolicy: { mode },
  });
}

function createMockService(mode: "runtime" | "health" = "runtime") {
  return RegisteredService.create({
    id: "mock-service",
    displayName: "Mock Service",
    managementAdapter: "mock",
    externalResourceId: "mock-resource",
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "manual" },
    readinessPolicy: { mode },
  });
}

function createPm2Service(mode: "runtime" | "health" = "runtime") {
  return RegisteredService.create({
    id: "pm2-service",
    displayName: "PM2 Service",
    managementAdapter: "pm2",
    externalResourceId: "pm2-resource",
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "manual" },
    readinessPolicy: { mode },
  });
}

function inspectOutput(status: string): string {
  return JSON.stringify([
    {
      State: { Status: "running", Health: { Status: status } },
      Config: { Image: "atlas:test" },
    },
  ]);
}

function composeOutput(
  services: ReadonlyArray<{
    readonly Name: string;
    readonly State: string;
    readonly Health?: string;
    readonly ExitCode: number;
  }>,
): string {
  return JSON.stringify(services);
}

describe("readiness infrastructure", () => {
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("rejects a %s readiness timer duration", async (_label, duration) => {
    const timer = new NodeServiceReadinessTimer();

    await expect(timer.sleep(duration)).rejects.toThrow(
      "Invalid sleep duration",
    );
  });

  it("uses one bounded timeout and no interval for a valid duration", async () => {
    vi.useFakeTimers();
    try {
      const timer = new NodeServiceReadinessTimer();
      const sleeping = timer.sleep(1);

      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(1);
      await sleeping;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["running", "ready"],
    ["stopped", "not_ready"],
    ["failed", "not_ready"],
    ["unknown", "not_ready"],
  ] as const)("maps runtime state %s", async (state, expected) => {
    const statusReader: ServiceStatusReader = {
      read: vi.fn().mockResolvedValue(state),
    };
    const reader = new RuntimeReadinessReader(statusReader, clock);
    const result = await reader.check(createDockerService("runtime"));

    expect(result).toEqual({
      serviceId: "docker-service",
      observedAt: "2026-07-27T12:00:00.000Z",
      state: expected,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(statusReader.read).toHaveBeenCalledOnce();
    expect(statusReader.read).toHaveBeenCalledWith(
      expect.objectContaining({ id: "docker-service" }),
    );
  });

  it("preserves runtime status-reader failures instead of returning not ready", async () => {
    const failure = new Error("status-reader-failure");
    const statusReader: ServiceStatusReader = {
      read: vi.fn().mockRejectedValue(failure),
    };
    const reader = new RuntimeReadinessReader(statusReader, clock);

    await expect(reader.check(createDockerService("runtime"))).rejects.toBe(
      failure,
    );
  });

  it.each([
    ["healthy", "ready"],
    ["starting", "not_ready"],
    ["unhealthy", "not_ready"],
    ["none", "not_ready"],
    ["unsupported", "not_ready"],
  ] as const)("maps Docker health state %s", async (state, expected) => {
    const executor: DockerContainerInspectExecutor = {
      execute: vi.fn().mockResolvedValue(inspectOutput(state)),
    };
    const reader = new DockerHealthReadinessReader(executor, clock);
    const result = await reader.check(createDockerService());

    expect(result).toEqual({
      serviceId: "docker-service",
      observedAt: "2026-07-27T12:00:00.000Z",
      state: expected,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(executor.execute).toHaveBeenCalledOnce();
    expect(executor.execute).toHaveBeenCalledWith("container");
  });

  it("maps an absent Docker health object to not ready", async () => {
    const executor: DockerContainerInspectExecutor = {
      execute: vi.fn().mockResolvedValue(
        JSON.stringify([
          {
            State: { Status: "running" },
            Config: { Image: "atlas:test" },
          },
        ]),
      ),
    };
    const reader = new DockerHealthReadinessReader(executor, clock);

    await expect(reader.check(createDockerService())).resolves.toMatchObject({
      state: "not_ready",
    });
  });

  it("rejects Docker adapter mismatches and inspect failures", async () => {
    const mismatchReader = new DockerHealthReadinessReader(
      { execute: vi.fn() },
      clock,
    );
    await expect(mismatchReader.check(createMockService())).rejects.toThrow(
      "Unsupported health readiness adapter",
    );

    const failure = new Error("inspect-failure");
    const executor: DockerContainerInspectExecutor = {
      execute: vi.fn().mockRejectedValue(failure),
    };
    const reader = new DockerHealthReadinessReader(executor, clock);
    await expect(reader.check(createDockerService())).rejects.toBe(failure);

    const malformedReader = new DockerHealthReadinessReader(
      { execute: vi.fn().mockResolvedValue("not-json") },
      clock,
    );
    await expect(malformedReader.check(createDockerService())).rejects.toThrow(
      "Docker inspect output parser failed",
    );
  });

  it.each([
    [
      "healthy",
      composeOutput([
        { Name: "api", State: "running", Health: "healthy", ExitCode: 0 },
        {
          Name: "worker",
          State: "running",
          Health: "healthy",
          ExitCode: 0,
        },
      ]),
      "ready",
    ],
    [
      "starting",
      composeOutput([
        { Name: "api", State: "running", Health: "healthy", ExitCode: 0 },
        {
          Name: "worker",
          State: "running",
          Health: "starting",
          ExitCode: 0,
        },
      ]),
      "not_ready",
    ],
    [
      "unhealthy",
      composeOutput([
        { Name: "api", State: "running", Health: "healthy", ExitCode: 0 },
        {
          Name: "worker",
          State: "running",
          Health: "unhealthy",
          ExitCode: 0,
        },
      ]),
      "not_ready",
    ],
    [
      "mixed",
      composeOutput([
        { Name: "api", State: "running", Health: "healthy", ExitCode: 0 },
        { Name: "worker", State: "running", Health: "none", ExitCode: 0 },
      ]),
      "not_ready",
    ],
    [
      "not_configured",
      composeOutput([
        { Name: "api", State: "running", Health: "none", ExitCode: 0 },
        { Name: "worker", State: "running", Health: "none", ExitCode: 0 },
      ]),
      "not_ready",
    ],
  ] as const)(
    "maps Compose aggregate health %s",
    async (_label, output, expected) => {
      const executor: DockerComposeProjectStatusExecutor = {
        execute: vi.fn().mockResolvedValue(output),
      };
      const composeReader = new ComposeHealthReadinessReader(executor, clock);
      const result = await composeReader.check(createComposeService());

      expect(result).toEqual({
        serviceId: "compose-service",
        observedAt: "2026-07-27T12:00:00.000Z",
        state: expected,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(executor.execute).toHaveBeenCalledOnce();
      expect(executor.execute).toHaveBeenCalledWith(
        "project",
        "/srv/project",
        "/srv/project/compose.yaml",
      );
    },
  );

  it("exposes unknown only for the domain's empty aggregate and rejects empty parser output", async () => {
    const emptyServices: readonly ComposeProjectService[] = [];
    expect(calculateComposeAggregateHealthState(emptyServices)).toBe("unknown");

    const executor: DockerComposeProjectStatusExecutor = {
      execute: vi.fn().mockResolvedValue("[]"),
    };
    const reader = new ComposeHealthReadinessReader(executor, clock);

    await expect(reader.check(createComposeService())).rejects.toThrow(
      "Compose status parser failed: empty_result",
    );
  });

  it("rejects Compose adapter/configuration mismatches and executor failures", async () => {
    const mismatchReader = new ComposeHealthReadinessReader(
      { execute: vi.fn() },
      clock,
    );
    await expect(mismatchReader.check(createMockService())).rejects.toThrow(
      "Unsupported health readiness adapter",
    );

    const malformedService = Object.freeze({
      ...createComposeService(),
      managementConfiguration: null,
    });
    await expect(mismatchReader.check(malformedService)).rejects.toThrow(
      "Unsupported health readiness adapter",
    );

    const failure = new Error("compose-status-failure");
    const reader = new ComposeHealthReadinessReader(
      { execute: vi.fn().mockRejectedValue(failure) },
      clock,
    );
    await expect(reader.check(createComposeService())).rejects.toBe(failure);
  });

  it("routes runtime readiness through the runtime reader for every adapter", async () => {
    const runtimeReader = {
      check: vi.fn().mockResolvedValue({
        serviceId: "runtime",
        observedAt: "2026-07-27T12:00:00.000Z",
        state: "ready" as const,
      }),
    };
    const dockerHealthReader = { check: vi.fn() };
    const composeHealthReader = { check: vi.fn() };
    const dispatched = createDispatchingReadinessReader({
      runtimeReader,
      dockerHealthReader,
      composeHealthReader,
    });

    await dispatched.check(createMockService());
    await dispatched.check(createPm2Service());
    await dispatched.check(createDockerService("runtime"));
    await dispatched.check(createComposeService("runtime"));

    expect(runtimeReader.check).toHaveBeenCalledTimes(4);
    expect(dockerHealthReader.check).not.toHaveBeenCalled();
    expect(composeHealthReader.check).not.toHaveBeenCalled();
  });

  it("routes each health policy to only its approved adapter reader", async () => {
    const runtimeReader = { check: vi.fn() };
    const dockerHealthReader = {
      check: vi.fn().mockResolvedValue({
        serviceId: "docker-service",
        observedAt: "2026-07-27T12:00:00.000Z",
        state: "ready" as const,
      }),
    };
    const composeHealthReader = {
      check: vi.fn().mockResolvedValue({
        serviceId: "compose-service",
        observedAt: "2026-07-27T12:00:00.000Z",
        state: "ready" as const,
      }),
    };
    const dispatched = createDispatchingReadinessReader({
      runtimeReader,
      dockerHealthReader,
      composeHealthReader,
    });

    await dispatched.check(createDockerService());
    await dispatched.check(createComposeService());

    expect(dockerHealthReader.check).toHaveBeenCalledOnce();
    expect(composeHealthReader.check).toHaveBeenCalledOnce();
    expect(runtimeReader.check).not.toHaveBeenCalled();
  });

  it("preserves the selected reader failure without fallback", async () => {
    const failure = new Error("selected-reader-failure");
    const runtimeReader = { check: vi.fn().mockRejectedValue(failure) };
    const dockerHealthReader = { check: vi.fn() };
    const composeHealthReader = { check: vi.fn() };
    const runtimeDispatched = createDispatchingReadinessReader({
      runtimeReader,
      dockerHealthReader,
      composeHealthReader,
    });

    await expect(
      runtimeDispatched.check(createDockerService("runtime")),
    ).rejects.toBe(failure);
    expect(dockerHealthReader.check).not.toHaveBeenCalled();
    expect(composeHealthReader.check).not.toHaveBeenCalled();

    const dockerFailure = new Error("docker-health-failure");
    const dockerRuntimeFallback = { check: vi.fn() };
    const dockerComposeFallback = { check: vi.fn() };
    const selectedDockerReader = {
      check: vi.fn().mockRejectedValue(dockerFailure),
    };
    const dockerHealthDispatched = createDispatchingReadinessReader({
      runtimeReader: dockerRuntimeFallback,
      dockerHealthReader: selectedDockerReader,
      composeHealthReader: dockerComposeFallback,
    });
    await expect(
      dockerHealthDispatched.check(createDockerService()),
    ).rejects.toBe(dockerFailure);
    expect(dockerRuntimeFallback.check).not.toHaveBeenCalled();
    expect(dockerComposeFallback.check).not.toHaveBeenCalled();

    const composeFailure = new Error("compose-health-failure");
    const composeRuntimeFallback = { check: vi.fn() };
    const composeDockerFallback = { check: vi.fn() };
    const selectedComposeReader = {
      check: vi.fn().mockRejectedValue(composeFailure),
    };
    const composeHealthDispatched = createDispatchingReadinessReader({
      runtimeReader: composeRuntimeFallback,
      dockerHealthReader: composeDockerFallback,
      composeHealthReader: selectedComposeReader,
    });
    await expect(
      composeHealthDispatched.check(createComposeService()),
    ).rejects.toBe(composeFailure);
    expect(composeRuntimeFallback.check).not.toHaveBeenCalled();
    expect(composeDockerFallback.check).not.toHaveBeenCalled();
  });
});
