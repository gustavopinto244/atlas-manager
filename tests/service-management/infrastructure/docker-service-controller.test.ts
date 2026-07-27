import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { DockerServiceController } from "../../../src/service-management/infrastructure/docker-service-controller.js";
import type { DockerContainerInspectExecutor } from "../../../src/service-management/infrastructure/docker-container-inspect-executor.js";
import type { DockerContainerControlExecutor } from "../../../src/service-management/infrastructure/docker-container-control-executor.js";

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

function createMockInspectExecutor(): DockerContainerInspectExecutor {
  return {
    execute: vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          State: { Status: "running" },
          Config: { Image: "app:latest" },
        },
      ]),
    ),
  };
}

function createMockControlExecutor(): DockerContainerControlExecutor & {
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

describe("DockerServiceController", () => {
  it("executes start operation", async () => {
    const inspectExecutor = createMockInspectExecutor();
    const controlExecutor = createMockControlExecutor();
    const controller = new DockerServiceController(
      inspectExecutor,
      controlExecutor,
    );
    const service = createDockerService();

    await controller.execute(service, "start");

    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "start",
      "container-name",
    );
  });

  it("executes stop operation", async () => {
    const inspectExecutor = createMockInspectExecutor();
    const controlExecutor = createMockControlExecutor();
    const controller = new DockerServiceController(
      inspectExecutor,
      controlExecutor,
    );
    const service = createDockerService();

    await controller.execute(service, "stop");

    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "stop",
      "container-name",
    );
  });

  it("executes restart operation", async () => {
    const inspectExecutor = createMockInspectExecutor();
    const controlExecutor = createMockControlExecutor();
    const controller = new DockerServiceController(
      inspectExecutor,
      controlExecutor,
    );
    const service = createDockerService();

    await controller.execute(service, "restart");

    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "restart",
      "container-name",
    );
  });

  it("propagates control executor errors", async () => {
    const inspectExecutor = createMockInspectExecutor();
    const controlExecutor = createMockControlExecutor();
    const error = new Error("Container not found");
    controlExecutor.execute.mockRejectedValue(error);
    const controller = new DockerServiceController(
      inspectExecutor,
      controlExecutor,
    );
    const service = createDockerService();

    await expect(controller.execute(service, "start")).rejects.toThrow();
  });

  it("uses the configured external resource ID", async () => {
    const inspectExecutor = createMockInspectExecutor();
    const controlExecutor = createMockControlExecutor();
    const controller = new DockerServiceController(
      inspectExecutor,
      controlExecutor,
    );
    const service = createDockerService({
      externalResourceId: "custom-container-id",
    });

    await controller.execute(service, "start");

    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "start",
      "custom-container-id",
    );
  });

  it("rejects operations for non-docker services", async () => {
    const inspectExecutor = createMockInspectExecutor();
    const controlExecutor = createMockControlExecutor();
    const controller = new DockerServiceController(
      inspectExecutor,
      controlExecutor,
    );
    const pm2Service = RegisteredService.create({
      id: "pm2-service",
      displayName: "PM2 Service",
      managementAdapter: "pm2",
      externalResourceId: "pm2-process",
      supportedOperations: ["readStatus", "start", "stop", "restart"],
      availabilityPolicy: { mode: "manual" },
    });

    await expect(controller.execute(pm2Service, "start")).rejects.toThrow();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it("executes only one command per operation", async () => {
    const inspectExecutor = createMockInspectExecutor();
    const controlExecutor = createMockControlExecutor();
    const controller = new DockerServiceController(
      inspectExecutor,
      controlExecutor,
    );
    const service = createDockerService();

    await controller.execute(service, "start");
    await controller.execute(service, "stop");

    expect(controlExecutor.execute).toHaveBeenCalledTimes(2);
  });
});
