/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import type {
  DockerComposeProjectStatusExecutor,
  DockerComposeProjectControlExecutor,
  DockerComposeProjectLogExecutor,
  DockerContainerLogExecutor,
} from "../../../src/service-management/infrastructure/docker-compose-executors.js";
import type { ServiceManagementCompositionOverrides } from "../../../src/service-management/composition/create-service-management.js";

describe("compose registered-service vertical slice", () => {
  const composeEnv = {
    REGISTERED_SERVICES_JSON: JSON.stringify([
      {
        id: "atlas-stack",
        displayName: "Atlas Stack",
        managementAdapter: "docker-compose",
        externalResourceId: "atlas-stack",
        supportedOperations: [
          "readStatus",
          "readLogs",
          "start",
          "stop",
          "restart",
        ],
        availabilityPolicy: { mode: "manual" },
        managementConfiguration: {
          composeFile: "/srv/atlas/compose.yaml",
          projectDirectory: "/srv/atlas",
        },
      },
    ]),
  };

  it("lists a registered compose project", async () => {
    const capabilities = createServiceManagement(composeEnv);

    const services = await capabilities.listRegisteredServices.execute();

    expect(services).toHaveLength(1);
    expect(services[0]?.id).toBe("atlas-stack");
    expect(services[0]?.managementAdapter).toBe("docker-compose");
  });

  it("reads compose project status", async () => {
    const statusExecutor: DockerComposeProjectStatusExecutor = {
      execute: vi.fn().mockResolvedValue(
        JSON.stringify([
          { Name: "api", State: "running", ExitCode: 0 },
          { Name: "db", State: "running", ExitCode: 0 },
        ]),
      ),
    };
    const overrides: ServiceManagementCompositionOverrides = {
      dockerComposeProjectStatusExecutor: statusExecutor,
    };
    const capabilities = createServiceManagement(composeEnv, overrides);

    const status =
      await capabilities.getRegisteredServiceStatus.execute("atlas-stack");

    expect(status.state).toBe("running");
    expect(statusExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "atlas-stack",
      "/srv/atlas",
      "/srv/atlas/compose.yaml",
    );
  });

  it("starts a compose project", async () => {
    const controlExecutor: DockerComposeProjectControlExecutor = {
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const overrides: ServiceManagementCompositionOverrides = {
      dockerComposeProjectControlExecutor: controlExecutor,
    };
    const capabilities = createServiceManagement(composeEnv, overrides);

    await capabilities.controlRegisteredService.execute("atlas-stack", "start");

    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "start",
      "atlas-stack",
      "/srv/atlas",
      "/srv/atlas/compose.yaml",
    );
  });

  it("stops a compose project", async () => {
    const controlExecutor: DockerComposeProjectControlExecutor = {
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const overrides: ServiceManagementCompositionOverrides = {
      dockerComposeProjectControlExecutor: controlExecutor,
    };
    const capabilities = createServiceManagement(composeEnv, overrides);

    await capabilities.controlRegisteredService.execute("atlas-stack", "stop");

    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "stop",
      "atlas-stack",
      "/srv/atlas",
      "/srv/atlas/compose.yaml",
    );
  });

  it("restarts a compose project", async () => {
    const controlExecutor: DockerComposeProjectControlExecutor = {
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const overrides: ServiceManagementCompositionOverrides = {
      dockerComposeProjectControlExecutor: controlExecutor,
    };
    const capabilities = createServiceManagement(composeEnv, overrides);

    await capabilities.controlRegisteredService.execute(
      "atlas-stack",
      "restart",
    );

    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "restart",
      "atlas-stack",
      "/srv/atlas",
      "/srv/atlas/compose.yaml",
    );
  });

  it("reads compose project logs", async () => {
    const logExecutor: DockerComposeProjectLogExecutor = {
      execute: vi
        .fn()
        .mockResolvedValue({ stdout: "compose-log-line", stderr: "" }),
    };
    const overrides: ServiceManagementCompositionOverrides = {
      dockerComposeProjectLogExecutor: logExecutor,
    };
    const capabilities = createServiceManagement(composeEnv, overrides);

    const logs = await capabilities.getRegisteredServiceLogs.execute(
      "atlas-stack",
      50,
    );

    expect(logs.stdoutLines).toEqual(["compose-log-line"]);
    expect(logExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "atlas-stack",
      "/srv/atlas",
      "/srv/atlas/compose.yaml",
      50,
    );
  });
});

describe("docker logs vertical slice", () => {
  const dockerEnv = {
    REGISTERED_SERVICES_JSON: JSON.stringify([
      {
        id: "atlas-api",
        displayName: "Atlas API",
        managementAdapter: "docker",
        externalResourceId: "atlas-api",
        supportedOperations: ["readStatus", "readLogs", "start", "stop"],
        availabilityPolicy: { mode: "always" },
      },
    ]),
  };

  it("reads docker container logs", async () => {
    const logExecutor: DockerContainerLogExecutor = {
      execute: vi
        .fn()
        .mockResolvedValue({ stdout: "container-log-line", stderr: "" }),
    };
    const overrides: ServiceManagementCompositionOverrides = {
      dockerContainerLogExecutor: logExecutor,
    };
    const capabilities = createServiceManagement(dockerEnv, overrides);

    const logs = await capabilities.getRegisteredServiceLogs.execute(
      "atlas-api",
      100,
    );

    expect(logs.stdoutLines).toEqual(["container-log-line"]);
    expect(logExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "atlas-api",
      100,
    );
  });

  it("rejects logs for service without readLogs", async () => {
    const env = {
      REGISTERED_SERVICES_JSON: JSON.stringify([
        {
          id: "no-log-svc",
          displayName: "No Log Svc",
          managementAdapter: "docker",
          externalResourceId: "no-log",
          supportedOperations: ["readStatus"],
          availabilityPolicy: { mode: "manual" },
        },
      ]),
    };
    const capabilities = createServiceManagement(env);

    await expect(
      capabilities.getRegisteredServiceLogs.execute("no-log-svc", 10),
    ).rejects.toThrow();
  });

  it("rejects invalid tail lines", async () => {
    const capabilities = createServiceManagement(dockerEnv);

    await expect(
      capabilities.getRegisteredServiceLogs.execute("atlas-api", 0),
    ).rejects.toThrow();
  });
});
