/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  normalizeLogOutput,
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
import { validateTailLines } from "../../../src/service-management/domain/service-log-tail-lines.js";

const collectedAt = new Date("2026-07-27T07:35:05.000Z");

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
  it.each([1, 100, 500])("accepts %i", (n) => {
    expect(() => validateTailLines(n)).not.toThrow();
  });
  it.each([0, -1, 501, 10.5])("rejects %s", (n) => {
    expect(() => validateTailLines(n)).toThrow();
  });
});

describe("normalizeLogOutput", () => {
  it("separates stdout and stderr lines", () => {
    const result = normalizeLogOutput(
      "svc1",
      collectedAt,
      "line1\nline2",
      "err1\nerr2",
    );
    expect(result.serviceId).toBe("svc1");
    expect(result.collectedAt).toBe("2026-07-27T07:35:05.000Z");
    expect(result.stdoutLines).toEqual(["line1", "line2"]);
    expect(result.stderrLines).toEqual(["err1", "err2"]);
    expect(result.truncated).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("removes ANSI escape sequences", () => {
    const result = normalizeLogOutput(
      "svc1",
      collectedAt,
      "\x1b[31mred text\x1b[0m",
      "",
    );
    expect(result.stdoutLines).toEqual(["red text"]);
  });

  it("normalizes control characters", () => {
    const result = normalizeLogOutput(
      "svc1",
      collectedAt,
      "text\x01with\x08control",
      "",
    );
    expect(result.stdoutLines).toEqual(["textwithcontrol"]);
  });

  it("truncates long lines and sets truncated", () => {
    const long = "a".repeat(5000);
    const result = normalizeLogOutput("svc1", collectedAt, long, "");
    expect(result.stdoutLines[0]?.length).toBeLessThanOrEqual(4096);
    expect(result.truncated).toBe(true);
  });

  it("handles empty output", () => {
    const result = normalizeLogOutput("svc1", collectedAt, "", "");
    expect(result.stdoutLines).toEqual([]);
    expect(result.stderrLines).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("DockerContainerLogReader", () => {
  it("reads container logs with tail", async () => {
    const executor: DockerContainerLogExecutor = {
      execute: vi.fn().mockResolvedValue({ stdout: "log1", stderr: "" }),
    };
    const reader = new DockerContainerLogReader(executor);
    const service = createDockerService();
    const result = await reader.readLogs(service, 50, collectedAt);
    expect(executor.execute).toHaveBeenCalledExactlyOnceWith(
      "my-container",
      50,
    );
    expect(result.stdoutLines).toEqual(["log1"]);
  });
});

describe("ComposeProjectLogReader", () => {
  it("reads compose project logs", async () => {
    const executor: DockerComposeProjectLogExecutor = {
      execute: vi.fn().mockResolvedValue({ stdout: "log1", stderr: "" }),
    };
    const reader = new ComposeProjectLogReader(executor);
    const service = createComposeService();
    const result = await reader.readLogs(service, 100, collectedAt);
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
    const result = await dispatcher.readLogs(
      createDockerService(),
      10,
      collectedAt,
    );
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
    const result = await dispatcher.readLogs(
      createComposeService(),
      10,
      collectedAt,
    );
    expect(result.stdoutLines).toEqual(["compose-log"]);
  });
});

describe("GetRegisteredServiceLogs", () => {
  const clock = { now: vi.fn(() => collectedAt) };

  it("returns logs for a service with readLogs", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = new DockerContainerLogReader({
      execute: vi.fn().mockResolvedValue({ stdout: "log", stderr: "" }),
    });
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader, clock);
    const result = await getLogs.execute("docker-svc", 10);
    expect(result.stdoutLines).toEqual(["log"]);
    expect(clock.now).toHaveBeenCalledOnce();
  });

  it("rejects unknown service", async () => {
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(null),
    };
    const logReader = new DockerContainerLogReader({ execute: vi.fn() });
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader, clock);
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
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader, clock);
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
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader, clock);
    await expect(getLogs.execute("docker-svc", 0)).rejects.toThrow();
  });
});
