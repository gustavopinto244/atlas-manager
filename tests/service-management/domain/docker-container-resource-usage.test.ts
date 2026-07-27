import { describe, expect, it } from "vitest";

import {
  createAvailableDockerContainerResourceUsage,
  createUnavailableDockerContainerResourceUsage,
} from "../../../src/service-management/domain/docker-container-resource-usage.js";

describe("DockerContainerResourceUsage", () => {
  describe("createAvailableDockerContainerResourceUsage", () => {
    it("creates an available resource usage with valid values", () => {
      const usage = createAvailableDockerContainerResourceUsage({
        cpuPercent: 25.5,
        memoryUsageBytes: 512 * 1024 * 1024,
        memoryLimitBytes: 2 * 1024 * 1024 * 1024,
        networkReceiveBytes: 10 * 1024 * 1024,
        networkTransmitBytes: 5 * 1024 * 1024,
        blockReadBytes: 100 * 1024 * 1024,
        blockWriteBytes: 50 * 1024 * 1024,
        pids: 10,
      });

      expect(usage.kind).toBe("available");
      if (usage.kind === "available") {
        expect(usage.cpuPercent).toBe(25.5);
        expect(usage.memoryUsageBytes).toBe(512 * 1024 * 1024);
        expect(usage.memoryLimitBytes).toBe(2 * 1024 * 1024 * 1024);
        expect(usage.networkReceiveBytes).toBe(10 * 1024 * 1024);
        expect(usage.networkTransmitBytes).toBe(5 * 1024 * 1024);
        expect(usage.blockReadBytes).toBe(100 * 1024 * 1024);
        expect(usage.blockWriteBytes).toBe(50 * 1024 * 1024);
        expect(usage.pids).toBe(10);
      }
    });

    it("allows CPU percentage above 100", () => {
      const usage = createAvailableDockerContainerResourceUsage({
        cpuPercent: 150,
        memoryUsageBytes: 1024,
        memoryLimitBytes: 2048,
        networkReceiveBytes: 100,
        networkTransmitBytes: 50,
        blockReadBytes: 1000,
        blockWriteBytes: 500,
        pids: 5,
      });

      expect(usage.kind).toBe("available");
      if (usage.kind === "available") {
        expect(usage.cpuPercent).toBe(150);
      }
    });

    it("allows zero values", () => {
      const usage = createAvailableDockerContainerResourceUsage({
        cpuPercent: 0,
        memoryUsageBytes: 0,
        memoryLimitBytes: 0,
        networkReceiveBytes: 0,
        networkTransmitBytes: 0,
        blockReadBytes: 0,
        blockWriteBytes: 0,
        pids: 0,
      });

      expect(usage.kind).toBe("available");
    });

    it("rejects negative CPU percentage", () => {
      expect(() =>
        createAvailableDockerContainerResourceUsage({
          cpuPercent: -10,
          memoryUsageBytes: 1024,
          memoryLimitBytes: 2048,
          networkReceiveBytes: 100,
          networkTransmitBytes: 50,
          blockReadBytes: 1000,
          blockWriteBytes: 500,
          pids: 5,
        }),
      ).toThrowError("Invalid cpuPercent");
    });

    it("rejects negative memory values", () => {
      expect(() =>
        createAvailableDockerContainerResourceUsage({
          cpuPercent: 10,
          memoryUsageBytes: -1024,
          memoryLimitBytes: 2048,
          networkReceiveBytes: 100,
          networkTransmitBytes: 50,
          blockReadBytes: 1000,
          blockWriteBytes: 500,
          pids: 5,
        }),
      ).toThrowError("Invalid memoryUsageBytes");
    });

    it("rejects non-integer PIDs", () => {
      expect(() =>
        createAvailableDockerContainerResourceUsage({
          cpuPercent: 10,
          memoryUsageBytes: 1024,
          memoryLimitBytes: 2048,
          networkReceiveBytes: 100,
          networkTransmitBytes: 50,
          blockReadBytes: 1000,
          blockWriteBytes: 500,
          pids: 5.5,
        }),
      ).toThrowError("pids must be an integer");
    });

    it("rejects negative PIDs", () => {
      expect(() =>
        createAvailableDockerContainerResourceUsage({
          cpuPercent: 10,
          memoryUsageBytes: 1024,
          memoryLimitBytes: 2048,
          networkReceiveBytes: 100,
          networkTransmitBytes: 50,
          blockReadBytes: 1000,
          blockWriteBytes: 500,
          pids: -5,
        }),
      ).toThrowError("Invalid pids");
    });

    it("creates a frozen object", () => {
      const usage = createAvailableDockerContainerResourceUsage({
        cpuPercent: 10,
        memoryUsageBytes: 1024,
        memoryLimitBytes: 2048,
        networkReceiveBytes: 100,
        networkTransmitBytes: 50,
        blockReadBytes: 1000,
        blockWriteBytes: 500,
        pids: 5,
      });

      expect(Object.isFrozen(usage)).toBe(true);
    });
  });

  describe("createUnavailableDockerContainerResourceUsage", () => {
    it("creates an unavailable resource usage for container_not_running", () => {
      const usage = createUnavailableDockerContainerResourceUsage(
        "container_not_running",
      );

      expect(usage.kind).toBe("unavailable");
      if (usage.kind === "unavailable") {
        expect(usage.reason).toBe("container_not_running");
      }
    });

    it("creates an unavailable resource usage for stats_unavailable", () => {
      const usage =
        createUnavailableDockerContainerResourceUsage("stats_unavailable");

      expect(usage.kind).toBe("unavailable");
      if (usage.kind === "unavailable") {
        expect(usage.reason).toBe("stats_unavailable");
      }
    });

    it("creates a frozen object", () => {
      const usage = createUnavailableDockerContainerResourceUsage(
        "container_not_running",
      );

      expect(Object.isFrozen(usage)).toBe(true);
    });
  });
});
