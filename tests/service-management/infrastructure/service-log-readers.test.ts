/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  normalizeLogOutput,
  validateTailLines,
  DockerContainerLogReader,
  ComposeProjectLogReader,
  DispatchingServiceLogReader,
} from "../../../src/service-management/infrastructure/service-log-readers.js";
import type {
  DockerContainerLogExecutor,
  DockerComposeProjectLogExecutor,
} from "../../../src/service-management/infrastructure/docker-compose-executors.js";
import {
  GetRegisteredServiceLogs,
  ServiceLogOperationNotSupportedError,
} from "../../../src/service-management/application/get-registered-service-logs.js";
import { RegisteredServiceNotFoundError } from "../../../src/service-management/application/registered-service-not-found-error.js";

function createDockerService(): RegisteredService {
  return RegisteredService.create({
    id: "docker-svc",
    displayName: "Docker Svc",
    managementAdapter: "docker",
    externalResourceId: "my-container",
    supportedOperations: ["readStatus", "readLogs", "start", "stop"],
    availabilityPolicy: { mode: "manual" },
  });
}

function createComposeService(): RegisteredService {
  return RegisteredService.create({
    id: "compose-svc",
    displayName: "Compose Svc",
    managementAdapter: "docker-compose",
    externalResourceId: "my-project",
    supportedOperations: ["readStatus", "readLogs", "start", "stop"],
    availabilityPolicy: { mode: "manual" },
    managementConfiguration: {
      composeFile: "/srv/compose.yaml",
      projectDirectory: "/srv",
    },
  });
}

describe("validateTailLines", () => {
  it("accepts valid tail lines", () => {
    expect(() => validateTailLines(1)).not.toThrow();
    expect(() => validateTailLines(100)).not.toThrow();
    expect(() => validateTailLines(500)).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => validateTailLines(0)).toThrow();
  });

  it("rejects negative", () => {
    expect(() => validateTailLines(-1)).toThrow();
  });

  it("rejects above maximum", () => {
    expect(() => validateTailLines(501)).toThrow();
  });

  it("rejects non-integer", () => {
    expect(() => validateTailLines(10.5)).toThrow();
  });
});

describe("normalizeLogOutput", () => {
  it("separates stdout and stderr lines", () => {
    const result = normalizeLogOutput("svc1", "line1\nline2", "err1\nerr2");

    expect(result.stdoutLines).toEqual(["line1", "line2"]);
    expect(result.stderrLines).toEqual(["err1", "err2"]);
    expect(result.truncated).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("removes ANSI escape sequences", () => {
    const result = normalizeLogOutput("svc1", "\x1b[31mred text\x1b[0m", "");

    expect(result.stdoutLines).toEqual(["red text"]);
  });

  it("normalizes control characters", () => {
    const result = normalizeLogOutput("svc1", "text\x01with\x08control", "");

    expect(result.stdoutLines).toEqual(["textwithcontrol"]);
  });

  it("truncates long lines", () => {
    const long = "a".repeat(5000);
    const result = normalizeLogOutput("svc1", long, "");

    expect(result.stdoutLines[0]?.length).toBeLessThanOrEqual(4096);
  });

  it("handles empty output", () => {
    const result = normalizeLogOutput("svc1", "", "");

    expect(result.stdoutLines).toEqual([]);
    expect(result.stderrLines).toEqual([]);
  });
});

describe("DockerContainerLogReader", () => {
  it("reads container logs with tail", async () => {
    const executor: DockerContainerLogExecutor = {
      execute: vi.fn().mockResolvedValue({ stdout: "log1", stderr: "" }),
    };
    const reader = new DockerContainerLogReader(executor);
    const service = createDockerService();

    const result = await reader.readLogs(service, 50);

    expect(executor.execute).toHaveBeenCalledExactlyOnceWith(
      "my-container",
      50,
    );
    expect(result.stdoutLines).toEqual(["log1"]);
  });

  it("rejects invalid tail lines", async () => {
    const executor: DockerContainerLogExecutor = { execute: vi.fn() };
    const reader = new DockerContainerLogReader(executor);

    await expect(reader.readLogs(createDockerService(), 0)).rejects.toThrow();
  });
});

describe("ComposeProjectLogReader", () => {
  it("reads compose project logs", async () => {
    const executor: DockerComposeProjectLogExecutor = {
      execute: vi.fn().mockResolvedValue({ stdout: "log1", stderr: "" }),
    };
    const reader = new ComposeProjectLogReader(executor);
    const service = createComposeService();

    const result = await reader.readLogs(service, 100);

    expect(executor.execute).toHaveBeenCalledExactlyOnceWith(
      "my-project",
      "/srv",
      "/srv/compose.yaml",
      100,
    );
    expect(result.stdoutLines).toEqual(["log1"]);
  });
});

describe("DispatchingServiceLogReader", () => {
  it("dispatches to docker reader for docker services", async () => {
    const dockerReader = new DockerContainerLogReader({
      execute: vi.fn().mockResolvedValue({ stdout: "docker-log", stderr: "" }),
    });
    const composeReader = new ComposeProjectLogReader({ execute: vi.fn() });
    const dispatcher = new DispatchingServiceLogReader(
      dockerReader,
      composeReader,
    );

    const result = await dispatcher.readLogs(createDockerService(), 10);

    expect(result.stdoutLines).toEqual(["docker-log"]);
  });

  it("dispatches to compose reader for compose services", async () => {
    const dockerReader = new DockerContainerLogReader({ execute: vi.fn() });
    const composeReader = new ComposeProjectLogReader({
      execute: vi.fn().mockResolvedValue({ stdout: "compose-log", stderr: "" }),
    });
    const dispatcher = new DispatchingServiceLogReader(
      dockerReader,
      composeReader,
    );

    const result = await dispatcher.readLogs(createComposeService(), 10);

    expect(result.stdoutLines).toEqual(["compose-log"]);
  });
});

describe("GetRegisteredServiceLogs", () => {
  it("returns logs for a service with readLogs", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = new DockerContainerLogReader({
      execute: vi.fn().mockResolvedValue({ stdout: "log", stderr: "" }),
    });
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    const result = await getLogs.execute("docker-svc", 10);

    expect(result.stdoutLines).toEqual(["log"]);
  });

  it("rejects unknown service", async () => {
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(null),
    };
    const logReader = new DockerContainerLogReader({ execute: vi.fn() });
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("unknown", 10)).rejects.toThrow(
      RegisteredServiceNotFoundError,
    );
  });

  it("rejects service without readLogs", async () => {
    const service = RegisteredService.create({
      id: "no-logs",
      displayName: "No Logs",
      managementAdapter: "docker",
      externalResourceId: "container",
      supportedOperations: ["readStatus"],
      availabilityPolicy: { mode: "manual" },
    });
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = new DockerContainerLogReader({ execute: vi.fn() });
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("no-logs", 10)).rejects.toThrow(
      ServiceLogOperationNotSupportedError,
    );
  });

  it("rejects invalid tail lines", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = new DockerContainerLogReader({ execute: vi.fn() });
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("docker-svc", 0)).rejects.toThrow();
  });
});
