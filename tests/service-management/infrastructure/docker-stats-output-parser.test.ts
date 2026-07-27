import { describe, expect, it } from "vitest";

import {
  parseDockerStatsOutput,
  DockerStatsOutputParserError,
} from "../../../src/service-management/infrastructure/docker-stats-output-parser.js";

describe("parseDockerStatsOutput", () => {
  it("parses valid stats output with SI units", () => {
    const output = JSON.stringify({
      CPU: "25.50%",
      MemUsage: "512MB / 2GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "10",
    });

    const result = parseDockerStatsOutput(output);

    expect(result.kind).toBe("available");
    if (result.kind === "available") {
      expect(result.cpuPercent).toBe(25.5);
      expect(result.memoryUsageBytes).toBe(512 * 1000 * 1000);
      expect(result.memoryLimitBytes).toBe(2 * 1000 * 1000 * 1000);
      expect(result.networkReceiveBytes).toBe(10 * 1000 * 1000);
      expect(result.networkTransmitBytes).toBe(5 * 1000 * 1000);
      expect(result.blockReadBytes).toBe(100 * 1000 * 1000);
      expect(result.blockWriteBytes).toBe(50 * 1000 * 1000);
      expect(result.pids).toBe(10);
    }
  });

  it("parses valid stats output with IEC units", () => {
    const output = JSON.stringify({
      CPU: "50.00%",
      MemUsage: "1GiB / 4GiB",
      MemPerc: "25.00%",
      NetIO: "100MiB / 50MiB",
      BlockIO: "1GiB / 500MiB",
      PIDs: "20",
    });

    const result = parseDockerStatsOutput(output);

    expect(result.kind).toBe("available");
    if (result.kind === "available") {
      expect(result.cpuPercent).toBe(50);
      expect(result.memoryUsageBytes).toBe(1024 * 1024 * 1024);
      expect(result.memoryLimitBytes).toBe(4 * 1024 * 1024 * 1024);
      expect(result.networkReceiveBytes).toBe(100 * 1024 * 1024);
      expect(result.networkTransmitBytes).toBe(50 * 1024 * 1024);
      expect(result.blockReadBytes).toBe(1024 * 1024 * 1024);
      expect(result.blockWriteBytes).toBe(500 * 1024 * 1024);
      expect(result.pids).toBe(20);
    }
  });

  it("allows CPU percentage above 100", () => {
    const output = JSON.stringify({
      CPU: "150.00%",
      MemUsage: "1GB / 4GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "10",
    });

    const result = parseDockerStatsOutput(output);

    expect(result.kind).toBe("available");
    if (result.kind === "available") {
      expect(result.cpuPercent).toBe(150);
    }
  });

  it("parses zero values correctly", () => {
    const output = JSON.stringify({
      CPU: "0.00%",
      MemUsage: "0B / 4GB",
      MemPerc: "0.00%",
      NetIO: "0B / 0B",
      BlockIO: "0B / 0B",
      PIDs: "0",
    });

    const result = parseDockerStatsOutput(output);

    expect(result.kind).toBe("available");
    if (result.kind === "available") {
      expect(result.cpuPercent).toBe(0);
      expect(result.memoryUsageBytes).toBe(0);
      expect(result.pids).toBe(0);
    }
  });

  it("throws error for invalid JSON", () => {
    expect(() => parseDockerStatsOutput("invalid json")).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for missing CPU field", () => {
    const output = JSON.stringify({
      MemUsage: "1GB / 4GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "10",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for invalid CPU format", () => {
    const output = JSON.stringify({
      CPU: "invalid",
      MemUsage: "1GB / 4GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "10",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for negative CPU percentage", () => {
    const output = JSON.stringify({
      CPU: "-10.00%",
      MemUsage: "1GB / 4GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "10",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for unknown unit", () => {
    const output = JSON.stringify({
      CPU: "25.00%",
      MemUsage: "1XB / 4GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "10",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for non-integer PIDs", () => {
    const output = JSON.stringify({
      CPU: "25.00%",
      MemUsage: "1GB / 4GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "10.5",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for negative PIDs", () => {
    const output = JSON.stringify({
      CPU: "25.00%",
      MemUsage: "1GB / 4GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "-10",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for invalid memory format", () => {
    const output = JSON.stringify({
      CPU: "25.00%",
      MemUsage: "invalid",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "100MB / 50MB",
      PIDs: "10",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for invalid network IO format", () => {
    const output = JSON.stringify({
      CPU: "25.00%",
      MemUsage: "1GB / 4GB",
      MemPerc: "25.00%",
      NetIO: "invalid",
      BlockIO: "100MB / 50MB",
      PIDs: "10",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });

  it("throws error for invalid block IO format", () => {
    const output = JSON.stringify({
      CPU: "25.00%",
      MemUsage: "1GB / 4GB",
      MemPerc: "25.00%",
      NetIO: "10MB / 5MB",
      BlockIO: "invalid",
      PIDs: "10",
    });

    expect(() => parseDockerStatsOutput(output)).toThrowError(
      DockerStatsOutputParserError,
    );
  });
});
