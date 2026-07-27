import { describe, expect, it } from "vitest";

import { createDockerContainerDetails } from "../../../src/service-management/domain/docker-container-details.js";
import { createAvailableDockerContainerResourceUsage } from "../../../src/service-management/domain/docker-container-resource-usage.js";

describe("createDockerContainerDetails", () => {
  it("creates a valid Docker container details object", () => {
    const resourceUsage = createAvailableDockerContainerResourceUsage({
      cpuPercent: 25.5,
      memoryUsageBytes: 512 * 1024 * 1024,
      memoryLimitBytes: 2 * 1024 * 1024 * 1024,
      networkReceiveBytes: 10 * 1024 * 1024,
      networkTransmitBytes: 5 * 1024 * 1024,
      blockReadBytes: 100 * 1024 * 1024,
      blockWriteBytes: 50 * 1024 * 1024,
      pids: 10,
    });

    const details = createDockerContainerDetails({
      serviceId: "docker-service",
      runtimeState: "running",
      healthState: "healthy",
      observedAt: "2026-01-01T12:00:00.000Z",
      startedAt: "2026-01-01T10:00:00.000Z",
      uptimeSeconds: 7200,
      image: "nginx:latest",
      resourceUsage,
    });

    expect(details.serviceId).toBe("docker-service");
    expect(details.runtimeState).toBe("running");
    expect(details.healthState).toBe("healthy");
    expect(details.observedAt).toBe("2026-01-01T12:00:00.000Z");
    expect(details.startedAt).toBe("2026-01-01T10:00:00.000Z");
    expect(details.uptimeSeconds).toBe(7200);
    expect(details.image).toBe("nginx:latest");
    expect(details.resourceUsage).toBe(resourceUsage);
  });

  it("allows null startedAt and uptimeSeconds", () => {
    const resourceUsage = createAvailableDockerContainerResourceUsage({
      cpuPercent: 10,
      memoryUsageBytes: 1024,
      memoryLimitBytes: 2048,
      networkReceiveBytes: 100,
      networkTransmitBytes: 50,
      blockReadBytes: 1000,
      blockWriteBytes: 500,
      pids: 5,
    });

    const details = createDockerContainerDetails({
      serviceId: "docker-service",
      runtimeState: "stopped",
      healthState: "not_configured",
      observedAt: "2026-01-01T12:00:00.000Z",
      startedAt: null,
      uptimeSeconds: null,
      image: "postgres:15",
      resourceUsage,
    });

    expect(details.startedAt).toBeNull();
    expect(details.uptimeSeconds).toBeNull();
  });

  it("rejects empty serviceId", () => {
    const resourceUsage = createAvailableDockerContainerResourceUsage({
      cpuPercent: 10,
      memoryUsageBytes: 1024,
      memoryLimitBytes: 2048,
      networkReceiveBytes: 100,
      networkTransmitBytes: 50,
      blockReadBytes: 1000,
      blockWriteBytes: 500,
      pids: 5,
    });

    expect(() =>
      createDockerContainerDetails({
        serviceId: "",
        runtimeState: "running",
        healthState: "healthy",
        observedAt: "2026-01-01T12:00:00.000Z",
        startedAt: null,
        uptimeSeconds: null,
        image: "nginx:latest",
        resourceUsage,
      }),
    ).toThrowError("serviceId is required");
  });

  it("rejects empty observedAt", () => {
    const resourceUsage = createAvailableDockerContainerResourceUsage({
      cpuPercent: 10,
      memoryUsageBytes: 1024,
      memoryLimitBytes: 2048,
      networkReceiveBytes: 100,
      networkTransmitBytes: 50,
      blockReadBytes: 1000,
      blockWriteBytes: 500,
      pids: 5,
    });

    expect(() =>
      createDockerContainerDetails({
        serviceId: "docker-service",
        runtimeState: "running",
        healthState: "healthy",
        observedAt: "",
        startedAt: null,
        uptimeSeconds: null,
        image: "nginx:latest",
        resourceUsage,
      }),
    ).toThrowError("observedAt is required");
  });

  it("rejects empty image", () => {
    const resourceUsage = createAvailableDockerContainerResourceUsage({
      cpuPercent: 10,
      memoryUsageBytes: 1024,
      memoryLimitBytes: 2048,
      networkReceiveBytes: 100,
      networkTransmitBytes: 50,
      blockReadBytes: 1000,
      blockWriteBytes: 500,
      pids: 5,
    });

    expect(() =>
      createDockerContainerDetails({
        serviceId: "docker-service",
        runtimeState: "running",
        healthState: "healthy",
        observedAt: "2026-01-01T12:00:00.000Z",
        startedAt: null,
        uptimeSeconds: null,
        image: "",
        resourceUsage,
      }),
    ).toThrowError("image is required");
  });

  it("rejects negative uptimeSeconds", () => {
    const resourceUsage = createAvailableDockerContainerResourceUsage({
      cpuPercent: 10,
      memoryUsageBytes: 1024,
      memoryLimitBytes: 2048,
      networkReceiveBytes: 100,
      networkTransmitBytes: 50,
      blockReadBytes: 1000,
      blockWriteBytes: 500,
      pids: 5,
    });

    expect(() =>
      createDockerContainerDetails({
        serviceId: "docker-service",
        runtimeState: "running",
        healthState: "healthy",
        observedAt: "2026-01-01T12:00:00.000Z",
        startedAt: "2026-01-01T10:00:00.000Z",
        uptimeSeconds: -100,
        image: "nginx:latest",
        resourceUsage,
      }),
    ).toThrowError("uptimeSeconds cannot be negative");
  });

  it("creates a frozen object", () => {
    const resourceUsage = createAvailableDockerContainerResourceUsage({
      cpuPercent: 10,
      memoryUsageBytes: 1024,
      memoryLimitBytes: 2048,
      networkReceiveBytes: 100,
      networkTransmitBytes: 50,
      blockReadBytes: 1000,
      blockWriteBytes: 500,
      pids: 5,
    });

    const details = createDockerContainerDetails({
      serviceId: "docker-service",
      runtimeState: "running",
      healthState: "healthy",
      observedAt: "2026-01-01T12:00:00.000Z",
      startedAt: null,
      uptimeSeconds: null,
      image: "nginx:latest",
      resourceUsage,
    });

    expect(Object.isFrozen(details)).toBe(true);
  });
});
