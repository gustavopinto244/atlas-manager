import { describe, expect, it } from "vitest";

import {
  NodeServerHealthReader,
  type NodeServerHealthReaderDependencies,
} from "../../../src/server-health/infrastructure/node-server-health-reader.js";

const capturedAt = "2026-07-20T12:00:00.000Z";

function createDependencies(
  overrides: Partial<NodeServerHealthReaderDependencies> = {},
): NodeServerHealthReaderDependencies {
  return {
    now: () => new Date(capturedAt),
    uptimeSeconds: () => 7_200,
    totalMemoryBytes: () => 8_000,
    freeMemoryBytes: () => 2_000,
    cpuLoadAverages: () => [0.42, 0.31, 0.24],
    ...overrides,
  };
}

describe("NodeServerHealthReader", () => {
  it("maps deterministic Node.js values to a complete snapshot", async () => {
    const reader = new NodeServerHealthReader(createDependencies());

    await expect(reader.read()).resolves.toEqual({
      capturedAtIso: capturedAt,
      uptimeSeconds: 7_200,
      totalMemoryBytes: 8_000,
      freeMemoryBytes: 2_000,
      usedMemoryBytes: 6_000,
      memoryUsagePercent: 75,
      cpuLoadAverage1Minute: 0.42,
      cpuLoadAverage5Minutes: 0.31,
      cpuLoadAverage15Minutes: 0.24,
    });
  });

  it("calculates used memory and its percentage", async () => {
    const reader = new NodeServerHealthReader(
      createDependencies({
        totalMemoryBytes: () => 10_000,
        freeMemoryBytes: () => 3_500,
      }),
    );

    const snapshot = await reader.read();

    expect(snapshot.usedMemoryBytes).toBe(6_500);
    expect(snapshot.memoryUsagePercent).toBe(65);
  });

  it("returns zero usage safely when total and free memory are zero", async () => {
    const reader = new NodeServerHealthReader(
      createDependencies({
        totalMemoryBytes: () => 0,
        freeMemoryBytes: () => 0,
      }),
    );

    const snapshot = await reader.read();

    expect(snapshot.usedMemoryBytes).toBe(0);
    expect(snapshot.memoryUsagePercent).toBe(0);
    expect(Number.isFinite(snapshot.memoryUsagePercent)).toBe(true);
  });

  it.each([
    ["negative uptime", { uptimeSeconds: () => -1 }],
    ["negative total memory", { totalMemoryBytes: () => -1 }],
    ["negative free memory", { freeMemoryBytes: () => -1 }],
    ["negative CPU load", { cpuLoadAverages: () => [-0.1, 0.2, 0.3] }],
    ["NaN", { totalMemoryBytes: () => Number.NaN }],
    ["positive infinity", { freeMemoryBytes: () => Number.POSITIVE_INFINITY }],
    ["negative infinity", { uptimeSeconds: () => Number.NEGATIVE_INFINITY }],
  ])("rejects %s platform values", async (_description, overrides) => {
    const reader = new NodeServerHealthReader(createDependencies(overrides));

    await expect(reader.read()).rejects.toThrow("Invalid server health value");
  });

  it("rejects free memory greater than total memory", async () => {
    const reader = new NodeServerHealthReader(
      createDependencies({
        totalMemoryBytes: () => 8_000,
        freeMemoryBytes: () => 8_001,
      }),
    );

    await expect(reader.read()).rejects.toThrow(
      "free memory exceeds total memory",
    );
  });

  it("rejects an invalid capture timestamp", async () => {
    const reader = new NodeServerHealthReader(
      createDependencies({ now: () => new Date(Number.NaN) }),
    );

    await expect(reader.read()).rejects.toThrow("capture timestamp");
  });

  it("rejects an incomplete CPU load average", async () => {
    const reader = new NodeServerHealthReader(
      createDependencies({ cpuLoadAverages: () => [0.42, 0.31] }),
    );

    await expect(reader.read()).rejects.toThrow("CPU load averages");
  });
});
