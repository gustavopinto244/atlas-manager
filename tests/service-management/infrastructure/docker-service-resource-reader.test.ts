import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { DockerServiceResourceReader } from "../../../src/service-management/infrastructure/docker-service-resource-reader.js";
import { DockerContainerStatsExecutorError } from "../../../src/service-management/infrastructure/docker-container-stats-executor.js";
import type { DockerContainerStatsExecutor } from "../../../src/service-management/infrastructure/docker-container-stats-executor.js";
import type { DockerContainerInspectExecutor } from "../../../src/service-management/infrastructure/docker-container-inspect-executor.js";

const NOW = new Date("2026-01-01T01:00:00.000Z");
const clock = { now: () => NOW };

function createService(
  managementAdapter: "mock" | "docker" = "docker",
): RegisteredService {
  return RegisteredService.create({
    id: "web",
    displayName: "Web",
    managementAdapter,
    externalResourceId: "web-container",
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "manual" },
  });
}

function statsOutput(overrides: Record<string, string> = {}): string {
  return JSON.stringify({
    CPU: "12.34%",
    MemUsage: "100MiB / 500MiB",
    MemPerc: "20.00%",
    NetIO: "1kB / 2kB",
    BlockIO: "1MB / 2MB",
    PIDs: "3",
    ...overrides,
  });
}

function inspectOutput(startedAt: string | null): string {
  return JSON.stringify([
    {
      State: {
        Status: "running",
        StartedAt: startedAt ?? "0001-01-01T00:00:00Z",
      },
      Config: { Image: "app:latest" },
    },
  ]);
}

function statsExecutor(result: string | Error): DockerContainerStatsExecutor {
  return {
    execute:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result),
  };
}

function inspectExecutor(
  result: string | Error,
): DockerContainerInspectExecutor {
  return {
    execute:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result),
  };
}

describe("DockerServiceResourceReader", () => {
  it("reports available cpu, memory-with-limit and uptime", async () => {
    const startedAt = new Date(NOW.getTime() - 120_000).toISOString();
    const reader = new DockerServiceResourceReader(
      statsExecutor(statsOutput()),
      inspectExecutor(inspectOutput(startedAt)),
      clock,
    );
    const observation = await reader.read(createService());
    expect(observation).toMatchObject({
      outcome: "available",
      cpu: { outcome: "available", usagePercent: 12.34 },
      memory: { outcome: "available" },
      uptimeSeconds: 120,
    });
    if (observation.outcome === "available") {
      expect(observation.memory).toMatchObject({
        usageBytes: 100 * 1024 * 1024,
        limitBytes: 500 * 1024 * 1024,
      });
      expect(
        observation.memory.outcome === "available" &&
          observation.memory.usagePercent,
      ).toBeCloseTo(20, 0);
    }
  });

  it("reports unsupported for a non-docker service", async () => {
    const reader = new DockerServiceResourceReader(
      statsExecutor(statsOutput()),
      inspectExecutor(inspectOutput(null)),
      clock,
    );
    const observation = await reader.read(createService("mock"));
    expect(observation).toEqual({
      outcome: "unavailable",
      observedAt: NOW.toISOString(),
      reason: "unsupported",
    });
  });

  it("reports timeout when the stats executor times out", async () => {
    const reader = new DockerServiceResourceReader(
      statsExecutor(new DockerContainerStatsExecutorError("stats_timeout")),
      inspectExecutor(inspectOutput(null)),
      clock,
    );
    const observation = await reader.read(createService());
    expect(observation).toEqual({
      outcome: "unavailable",
      observedAt: NOW.toISOString(),
      reason: "timeout",
    });
  });

  it("reports permission_denied without leaking command details", async () => {
    const reader = new DockerServiceResourceReader(
      statsExecutor(
        new DockerContainerStatsExecutorError("docker_permission_denied"),
      ),
      inspectExecutor(inspectOutput(null)),
      clock,
    );
    const observation = await reader.read(createService());
    expect(observation).toEqual({
      outcome: "unavailable",
      observedAt: NOW.toISOString(),
      reason: "permission_denied",
    });
    expect(JSON.stringify(observation)).not.toMatch(/docker|stats/i);
  });

  it("reports invalid_response for malformed stats output", async () => {
    const reader = new DockerServiceResourceReader(
      statsExecutor("not json"),
      inspectExecutor(inspectOutput(null)),
      clock,
    );
    const observation = await reader.read(createService());
    expect(observation).toEqual({
      outcome: "unavailable",
      observedAt: NOW.toISOString(),
      reason: "invalid_response",
    });
  });

  it("returns null uptime rather than failing the whole read when inspect fails", async () => {
    const reader = new DockerServiceResourceReader(
      statsExecutor(statsOutput()),
      inspectExecutor(new Error("inspect failed")),
      clock,
    );
    const observation = await reader.read(createService());
    expect(observation).toMatchObject({
      outcome: "available",
      uptimeSeconds: null,
    });
  });

  it("does not report a memory limit when the container has none", async () => {
    const reader = new DockerServiceResourceReader(
      statsExecutor(statsOutput({ MemUsage: "100MiB / 0B", MemPerc: "0.00%" })),
      inspectExecutor(inspectOutput(null)),
      clock,
    );
    const observation = await reader.read(createService());
    expect(observation).toMatchObject({
      memory: { limitBytes: null, usagePercent: null },
    });
  });
});
