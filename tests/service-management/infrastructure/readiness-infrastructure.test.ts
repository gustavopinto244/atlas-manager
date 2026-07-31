/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import {
  RuntimeReadinessReader,
  DockerHealthReadinessReader,
  ComposeHealthReadinessReader,
  createDispatchingReadinessReader,
} from "../../../src/service-management/infrastructure/readiness-infrastructure.js";
import type { ServiceStatusReader } from "../../../src/service-management/application/ports/service-status-reader.js";
import type { DockerContainerInspectExecutor } from "../../../src/service-management/infrastructure/docker-container-inspect-executor.js";
import type { DockerComposeProjectStatusExecutor } from "../../../src/service-management/infrastructure/docker-compose-executors.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";

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

function createComposeService() {
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
    readinessPolicy: { mode: "health" },
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

describe("readiness infrastructure", () => {
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
    await expect(reader.check(createDockerService("runtime"))).resolves.toEqual(
      {
        serviceId: "docker-service",
        observedAt: "2026-07-27T12:00:00.000Z",
        state: expected,
      },
    );
  });

  it.each([
    ["healthy", "ready"],
    ["starting", "not_ready"],
    ["unhealthy", "not_ready"],
  ] as const)("maps Docker health state %s", async (state, expected) => {
    const executor: DockerContainerInspectExecutor = {
      execute: vi.fn().mockResolvedValue(inspectOutput(state)),
    };
    const reader = new DockerHealthReadinessReader(executor, clock);
    await expect(reader.check(createDockerService())).resolves.toMatchObject({
      state: expected,
    });
  });

  it("maps Compose aggregate health and dispatches by policy", async () => {
    const executor: DockerComposeProjectStatusExecutor = {
      execute: vi.fn().mockResolvedValue(
        JSON.stringify([
          { Name: "api", State: "running", Health: "healthy", ExitCode: 0 },
          { Name: "worker", State: "running", Health: "healthy", ExitCode: 0 },
        ]),
      ),
    };
    const composeReader = new ComposeHealthReadinessReader(executor, clock);
    const runtimeReader: ServiceStatusReader = {
      read: vi.fn().mockResolvedValue("running"),
    };
    const dispatched = createDispatchingReadinessReader({
      runtimeReader: new RuntimeReadinessReader(runtimeReader, clock),
      dockerHealthReader: new DockerHealthReadinessReader(
        { execute: vi.fn().mockResolvedValue(inspectOutput("healthy")) },
        clock,
      ),
      composeHealthReader: composeReader,
    });

    await expect(
      dispatched.check(createComposeService()),
    ).resolves.toMatchObject({
      state: "ready",
    });
    expect(executor.execute).toHaveBeenCalledOnce();
  });
});
