import { describe, expect, it, vi } from "vitest";

import {
  GetRegisteredServiceLogs,
  ServiceLogOperationNotSupportedError,
} from "../../../src/service-management/application/get-registered-service-logs.js";
import { RegisteredServiceNotFoundError } from "../../../src/service-management/application/registered-service-not-found-error.js";
import type { ServiceLogReader } from "../../../src/service-management/application/ports/service-log-reader.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { ServiceLogBatch } from "../../../src/service-management/domain/service-log-batch.js";

function createLogReader(
  result: ServiceLogBatch,
): ServiceLogReader & { readLogs: ReturnType<typeof vi.fn> } {
  return {
    readLogs: vi.fn().mockResolvedValue(result),
  };
}

function createSampleLogBatch(serviceId: string): ServiceLogBatch {
  return {
    serviceId,
    collectedAt: "2026-01-01T12:00:00.000Z",
    stdoutLines: ["line1", "line2"],
    stderrLines: [],
    truncated: false,
  };
}

function createDockerService(
  overrides: Partial<{
    id: string;
    supportedOperations: readonly string[];
  }> = {},
): RegisteredService {
  return RegisteredService.create({
    id: overrides.id ?? "docker-svc",
    displayName: "Docker Svc",
    managementAdapter: "docker",
    externalResourceId: "container",
    supportedOperations: overrides.supportedOperations ?? [
      "readStatus",
      "readLogs",
    ],
    availabilityPolicy: { mode: "manual" },
  });
}

describe("GetRegisteredServiceLogs", () => {
  it("returns log batch for a service with readLogs using default tailLines", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const batch = createSampleLogBatch("docker-svc");
    const logReader = createLogReader(batch);
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    const result = await getLogs.execute("docker-svc");

    expect(result).toBe(batch);
    expect(result.serviceId).toBe("docker-svc");
    expect(logReader.readLogs).toHaveBeenCalledExactlyOnceWith(service, 100);
  });

  it("accepts minimum tailLines", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const batch = createSampleLogBatch("docker-svc");
    const logReader = createLogReader(batch);
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await getLogs.execute("docker-svc", 1);

    expect(logReader.readLogs).toHaveBeenCalledExactlyOnceWith(service, 1);
  });

  it("accepts maximum tailLines", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const batch = createSampleLogBatch("docker-svc");
    const logReader = createLogReader(batch);
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await getLogs.execute("docker-svc", 500);

    expect(logReader.readLogs).toHaveBeenCalledExactlyOnceWith(service, 500);
  });

  it("rejects unknown service", async () => {
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(null),
    };
    const logReader = createLogReader(createSampleLogBatch("x"));
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("unknown")).rejects.toThrow(
      RegisteredServiceNotFoundError,
    );
    expect(logReader.readLogs).not.toHaveBeenCalled();
  });

  it("rejects service without readLogs", async () => {
    const service = createDockerService({
      supportedOperations: ["readStatus"],
    });
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = createLogReader(createSampleLogBatch("docker-svc"));
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("docker-svc")).rejects.toThrow(
      ServiceLogOperationNotSupportedError,
    );
    expect(logReader.readLogs).not.toHaveBeenCalled();
  });

  it("rejects zero tailLines", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = createLogReader(createSampleLogBatch("docker-svc"));
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("docker-svc", 0)).rejects.toThrow();
    expect(logReader.readLogs).not.toHaveBeenCalled();
  });

  it("rejects tailLines above maximum", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = createLogReader(createSampleLogBatch("docker-svc"));
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("docker-svc", 501)).rejects.toThrow();
    expect(logReader.readLogs).not.toHaveBeenCalled();
  });

  it("rejects negative tailLines", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = createLogReader(createSampleLogBatch("docker-svc"));
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("docker-svc", -1)).rejects.toThrow();
    expect(logReader.readLogs).not.toHaveBeenCalled();
  });

  it("rejects non-integer tailLines", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const logReader = createLogReader(createSampleLogBatch("docker-svc"));
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await expect(getLogs.execute("docker-svc", 10.5)).rejects.toThrow();
    expect(logReader.readLogs).not.toHaveBeenCalled();
  });

  it("preserves the exact log reader result", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const batch = createSampleLogBatch("docker-svc");
    const logReader = createLogReader(batch);
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    const result = await getLogs.execute("docker-svc", 50);

    expect(result.stdoutLines).toEqual(["line1", "line2"]);
    expect(result.stderrLines).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("delegates to the correct log reader for docker", async () => {
    const service = createDockerService();
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const batch = createSampleLogBatch("docker-svc");
    const logReader = createLogReader(batch);
    const getLogs = new GetRegisteredServiceLogs(catalog, logReader);

    await getLogs.execute("docker-svc", 25);

    expect(logReader.readLogs).toHaveBeenCalledExactlyOnceWith(service, 25);
  });
});
