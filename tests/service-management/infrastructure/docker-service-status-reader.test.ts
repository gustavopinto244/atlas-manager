import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { DockerServiceStatusReader } from "../../../src/service-management/infrastructure/docker-service-status-reader.js";
import type { DockerContainerInspectExecutor } from "../../../src/service-management/infrastructure/docker-container-inspect-executor.js";

function createDockerService(
  overrides: Partial<{
    id: string;
    displayName: string;
    externalResourceId: string;
    supportedOperations: readonly string[];
  }> = {},
): RegisteredService {
  return RegisteredService.create({
    id: overrides.id ?? "docker-service",
    displayName: overrides.displayName ?? "Docker Service",
    managementAdapter: "docker",
    externalResourceId: overrides.externalResourceId ?? "container-name",
    supportedOperations: overrides.supportedOperations ?? [
      "readStatus",
      "start",
      "stop",
      "restart",
    ],
    availabilityPolicy: { mode: "manual" },
  });
}

function createMockInspectExecutor(
  output: string,
): DockerContainerInspectExecutor & {
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    execute: vi.fn().mockResolvedValue(output),
  };
}

describe("DockerServiceStatusReader", () => {
  it("maps running container to running state", async () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "running",
        },
        Config: {
          Image: "nginx:latest",
        },
      },
    ]);
    const executor = createMockInspectExecutor(output);
    const reader = new DockerServiceStatusReader(executor);
    const service = createDockerService();

    const result = await reader.read(service);

    expect(result).toBe("running");
    expect(executor.execute).toHaveBeenCalledExactlyOnceWith("container-name");
  });

  it("maps exited container to stopped state", async () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "exited",
        },
        Config: {
          Image: "postgres:15",
        },
      },
    ]);
    const executor = createMockInspectExecutor(output);
    const reader = new DockerServiceStatusReader(executor);
    const service = createDockerService();

    const result = await reader.read(service);

    expect(result).toBe("stopped");
  });

  it("maps dead container to failed state", async () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "dead",
        },
        Config: {
          Image: "app:latest",
        },
      },
    ]);
    const executor = createMockInspectExecutor(output);
    const reader = new DockerServiceStatusReader(executor);
    const service = createDockerService();

    const result = await reader.read(service);

    expect(result).toBe("failed");
  });

  it("maps paused container to unknown state", async () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "paused",
        },
        Config: {
          Image: "app:latest",
        },
      },
    ]);
    const executor = createMockInspectExecutor(output);
    const reader = new DockerServiceStatusReader(executor);
    const service = createDockerService();

    const result = await reader.read(service);

    expect(result).toBe("unknown");
  });

  it("maps restarting container to unknown state", async () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "restarting",
        },
        Config: {
          Image: "app:latest",
        },
      },
    ]);
    const executor = createMockInspectExecutor(output);
    const reader = new DockerServiceStatusReader(executor);
    const service = createDockerService();

    const result = await reader.read(service);

    expect(result).toBe("unknown");
  });

  it("propagates executor errors", async () => {
    const error = new Error("Docker daemon unavailable");
    const executor: DockerContainerInspectExecutor = {
      execute: vi.fn().mockRejectedValue(error),
    };
    const reader = new DockerServiceStatusReader(executor);
    const service = createDockerService();

    await expect(reader.read(service)).rejects.toThrow();
  });

  it("propagates parser errors", async () => {
    const executor = createMockInspectExecutor("invalid json");
    const reader = new DockerServiceStatusReader(executor);
    const service = createDockerService();

    await expect(reader.read(service)).rejects.toThrow();
  });

  it("uses the configured external resource ID", async () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "running",
        },
        Config: {
          Image: "app:latest",
        },
      },
    ]);
    const executor = createMockInspectExecutor(output);
    const reader = new DockerServiceStatusReader(executor);
    const service = createDockerService({
      externalResourceId: "custom-container-id",
    });

    await reader.read(service);

    expect(executor.execute).toHaveBeenCalledExactlyOnceWith(
      "custom-container-id",
    );
  });
});
