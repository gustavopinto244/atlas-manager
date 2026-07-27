/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { ComposeServiceStatusReader } from "../../../src/service-management/infrastructure/compose-service-status-reader.js";
import { ComposeServiceController } from "../../../src/service-management/infrastructure/compose-service-controller.js";
import type { DockerComposeProjectStatusExecutor } from "../../../src/service-management/infrastructure/docker-compose-executors.js";
import type { DockerComposeProjectControlExecutor } from "../../../src/service-management/infrastructure/docker-compose-executors.js";

function createComposeService(
  overrides: {
    id?: string;
    externalResourceId?: string;
    composeFile?: string;
    projectDirectory?: string;
  } = {},
): RegisteredService {
  return RegisteredService.create({
    id: overrides.id ?? "compose-service",
    displayName: "Compose Service",
    managementAdapter: "docker-compose",
    externalResourceId: overrides.externalResourceId ?? "my-project",
    supportedOperations: ["readStatus", "start", "stop", "restart"],
    availabilityPolicy: { mode: "manual" },
    managementConfiguration: {
      composeFile: overrides.composeFile ?? "/srv/compose.yaml",
      projectDirectory: overrides.projectDirectory ?? "/srv",
    },
  });
}

describe("ComposeServiceStatusReader", () => {
  const runningOutput = JSON.stringify([
    { Name: "api", State: "running", ExitCode: 0 },
  ]);

  it("returns running for all-running project", async () => {
    const executor: DockerComposeProjectStatusExecutor = {
      execute: vi.fn().mockResolvedValue(runningOutput),
    };
    const reader = new ComposeServiceStatusReader(executor);
    const service = createComposeService();

    const result = await reader.read(service);

    expect(result).toBe("running");
    expect(executor.execute).toHaveBeenCalledExactlyOnceWith(
      "my-project",
      "/srv",
      "/srv/compose.yaml",
    );
  });

  it("returns stopped for all-stopped project", async () => {
    const output = JSON.stringify([
      { Name: "api", State: "exited", ExitCode: 0 },
    ]);
    const executor: DockerComposeProjectStatusExecutor = {
      execute: vi.fn().mockResolvedValue(output),
    };
    const reader = new ComposeServiceStatusReader(executor);

    const result = await reader.read(createComposeService());

    expect(result).toBe("stopped");
  });

  it("propagates executor errors", async () => {
    const executor: DockerComposeProjectStatusExecutor = {
      execute: vi.fn().mockRejectedValue(new Error("timeout")),
    };
    const reader = new ComposeServiceStatusReader(executor);

    await expect(reader.read(createComposeService())).rejects.toThrow();
  });
});

describe("ComposeServiceController", () => {
  it("executes start on compose project", async () => {
    const executor: DockerComposeProjectControlExecutor = {
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new ComposeServiceController(executor);
    const service = createComposeService();

    await controller.execute(service, "start");

    expect(executor.execute).toHaveBeenCalledExactlyOnceWith(
      "start",
      "my-project",
      "/srv",
      "/srv/compose.yaml",
    );
  });

  it("executes stop on compose project", async () => {
    const executor: DockerComposeProjectControlExecutor = {
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new ComposeServiceController(executor);
    const service = createComposeService();

    await controller.execute(service, "stop");

    expect(executor.execute).toHaveBeenCalledExactlyOnceWith(
      "stop",
      "my-project",
      "/srv",
      "/srv/compose.yaml",
    );
  });

  it("propagates control executor errors", async () => {
    const executor: DockerComposeProjectControlExecutor = {
      execute: vi.fn().mockRejectedValue(new Error("timeout")),
    };
    const controller = new ComposeServiceController(executor);

    await expect(
      controller.execute(createComposeService(), "start"),
    ).rejects.toThrow();
  });
});
