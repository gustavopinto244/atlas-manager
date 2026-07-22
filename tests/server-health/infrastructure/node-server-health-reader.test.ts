import { describe, expect, it, vi } from "vitest";

import {
  calculateCpuUsagePercentFromDeltas,
  NodeServerHealthReader,
  type CpuTimes,
  type NodeServerHealthReaderDependencies,
} from "../../../src/server-health/infrastructure/node-server-health-reader.js";

const capturedAt = "2026-07-20T12:00:00.000Z";
const firstCpuSample: readonly CpuTimes[] = [
  { user: 100, nice: 0, sys: 50, idle: 250, irq: 0 },
];
const secondCpuSample: readonly CpuTimes[] = [
  { user: 120, nice: 0, sys: 60, idle: 340, irq: 0 },
];

function createDependencies(
  overrides: Partial<NodeServerHealthReaderDependencies> = {},
): NodeServerHealthReaderDependencies {
  const cpuTimes = vi
    .fn<() => readonly CpuTimes[]>()
    .mockReturnValueOnce(firstCpuSample)
    .mockReturnValueOnce(secondCpuSample);

  return {
    now: () => new Date(capturedAt),
    uptimeSeconds: () => 7_200,
    totalMemoryBytes: () => 8_000,
    freeMemoryBytes: () => 2_000,
    cpuLoadAverages: () => [0.42, 0.31, 0.24],
    cpuTimes,
    waitForCpuSample: () => Promise.resolve(),
    filesystemStats: () =>
      Promise.resolve({
        blockSizeBytes: 1_000,
        totalBlocks: 240,
        availableBlocks: 90,
      }),
    ...overrides,
  };
}

function createCpuTimesReader(
  first: readonly CpuTimes[],
  second: readonly CpuTimes[],
): () => readonly CpuTimes[] {
  return vi
    .fn<() => readonly CpuTimes[]>()
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second);
}

describe("NodeServerHealthReader", () => {
  it("maps deterministic Node.js values to a complete snapshot", async () => {
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies(),
    );

    await expect(reader.read()).resolves.toEqual({
      capturedAtIso: capturedAt,
      uptimeSeconds: 7_200,
      totalMemoryBytes: 8_000,
      freeMemoryBytes: 2_000,
      usedMemoryBytes: 6_000,
      memoryUsagePercent: 75,
      cpuUsagePercent: 25,
      cpuLoadAverage1Minute: 0.42,
      cpuLoadAverage5Minutes: 0.31,
      cpuLoadAverage15Minutes: 0.24,
      diskTotalBytes: 240_000,
      diskAvailableBytes: 90_000,
      diskUsedBytes: 150_000,
      diskUsagePercent: 62.5,
    });
  });

  it.each([
    [
      "zero utilization",
      [{ user: 10, nice: 10, sys: 10, idle: 10, irq: 10 }],
      [{ user: 10, nice: 10, sys: 10, idle: 60, irq: 10 }],
      0,
    ],
    [
      "full utilization",
      [{ user: 10, nice: 10, sys: 10, idle: 10, irq: 10 }],
      [{ user: 30, nice: 15, sys: 20, idle: 10, irq: 25 }],
      100,
    ],
    [
      "partial decimal utilization",
      [{ user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }],
      [{ user: 30, nice: 7, sys: 10, idle: 153, irq: 0 }],
      23.5,
    ],
    [
      "multiple logical CPUs",
      [
        { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        { user: 100, nice: 0, sys: 0, idle: 100, irq: 0 },
      ],
      [
        { user: 25, nice: 0, sys: 0, idle: 75, irq: 0 },
        { user: 175, nice: 0, sys: 0, idle: 125, irq: 0 },
      ],
      50,
    ],
  ] as const)(
    "calculates %s",
    async (_description, first, second, expected) => {
      const reader = new NodeServerHealthReader(
        "/test-root",
        createDependencies({ cpuTimes: createCpuTimesReader(first, second) }),
      );

      const snapshot = await reader.read();

      expect(snapshot.cpuUsagePercent).toBe(expected);
    },
  );

  it("rejects an idle delta greater than the total delta", () => {
    expect(() => calculateCpuUsagePercentFromDeltas(100, 101)).toThrow(
      "CPU idle time delta",
    );
  });

  it("uses the injected wait between CPU samples without a real delay", async () => {
    const events: string[] = [];
    const cpuTimes = vi
      .fn<() => readonly CpuTimes[]>()
      .mockImplementationOnce(() => {
        events.push("first sample");
        return firstCpuSample;
      })
      .mockImplementationOnce(() => {
        events.push("second sample");
        return secondCpuSample;
      });
    const waitForCpuSample = vi.fn().mockImplementation(() => {
      events.push("wait");
      return Promise.resolve();
    });
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({ cpuTimes, waitForCpuSample }),
    );

    await reader.read();

    expect(events).toEqual(["first sample", "wait", "second sample"]);
    expect(waitForCpuSample).toHaveBeenCalledOnce();
  });

  it.each([
    ["empty samples", [], []],
    [
      "mismatched logical CPU counts",
      firstCpuSample,
      [...secondCpuSample, ...secondCpuSample],
    ],
    [
      "a negative time",
      [{ user: -1, nice: 0, sys: 0, idle: 0, irq: 0 }],
      [{ user: 1, nice: 0, sys: 0, idle: 1, irq: 0 }],
    ],
    [
      "a non-finite time",
      [{ user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }],
      [
        {
          user: Number.POSITIVE_INFINITY,
          nice: 0,
          sys: 0,
          idle: 1,
          irq: 0,
        },
      ],
    ],
    [
      "a decreasing counter",
      [{ user: 2, nice: 0, sys: 0, idle: 0, irq: 0 }],
      [{ user: 1, nice: 0, sys: 0, idle: 1, irq: 0 }],
    ],
    [
      "a zero total delta",
      [{ user: 1, nice: 1, sys: 1, idle: 1, irq: 1 }],
      [{ user: 1, nice: 1, sys: 1, idle: 1, irq: 1 }],
    ],
  ] as const)(
    "rejects %s in CPU samples",
    async (_description, first, second) => {
      const reader = new NodeServerHealthReader(
        "/test-root",
        createDependencies({ cpuTimes: createCpuTimesReader(first, second) }),
      );

      await expect(reader.read()).rejects.toThrow(
        "Invalid server health value",
      );
    },
  );

  it("passes the configured filesystem path only to the injected reader", async () => {
    const filesystemStats = vi.fn().mockResolvedValue({
      blockSizeBytes: 1_000,
      totalBlocks: 240,
      availableBlocks: 90,
    });
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({ filesystemStats }),
    );

    await reader.read();

    expect(filesystemStats).toHaveBeenCalledOnce();
    expect(filesystemStats).toHaveBeenCalledWith("/test-root");
  });

  it("calculates used disk capacity and its percentage", async () => {
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({
        filesystemStats: () =>
          Promise.resolve({
            blockSizeBytes: 512,
            totalBlocks: 1_000,
            availableBlocks: 250,
          }),
      }),
    );

    const snapshot = await reader.read();

    expect(snapshot.diskTotalBytes).toBe(512_000);
    expect(snapshot.diskAvailableBytes).toBe(128_000);
    expect(snapshot.diskUsedBytes).toBe(384_000);
    expect(snapshot.diskUsagePercent).toBe(75);
  });

  it("returns zero disk usage safely when capacity is zero", async () => {
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({
        filesystemStats: () =>
          Promise.resolve({
            blockSizeBytes: 0,
            totalBlocks: 0,
            availableBlocks: 0,
          }),
      }),
    );

    const snapshot = await reader.read();

    expect(snapshot.diskUsedBytes).toBe(0);
    expect(snapshot.diskUsagePercent).toBe(0);
    expect(Number.isFinite(snapshot.diskUsagePercent)).toBe(true);
  });

  it("calculates used memory and its percentage", async () => {
    const reader = new NodeServerHealthReader(
      "/test-root",
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
      "/test-root",
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
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies(overrides),
    );

    await expect(reader.read()).rejects.toThrow("Invalid server health value");
  });

  it("rejects free memory greater than total memory", async () => {
    const reader = new NodeServerHealthReader(
      "/test-root",
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
      "/test-root",
      createDependencies({ now: () => new Date(Number.NaN) }),
    );

    await expect(reader.read()).rejects.toThrow("capture timestamp");
  });

  it("rejects an incomplete CPU load average", async () => {
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({ cpuLoadAverages: () => [0.42, 0.31] }),
    );

    await expect(reader.read()).rejects.toThrow("CPU load averages");
  });

  it.each([
    [
      "negative block size",
      { blockSizeBytes: -1, totalBlocks: 1, availableBlocks: 1 },
    ],
    [
      "negative total blocks",
      { blockSizeBytes: 1, totalBlocks: -1, availableBlocks: 0 },
    ],
    [
      "negative available blocks",
      { blockSizeBytes: 1, totalBlocks: 1, availableBlocks: -1 },
    ],
    ["NaN", { blockSizeBytes: Number.NaN, totalBlocks: 1, availableBlocks: 1 }],
    [
      "positive infinity",
      {
        blockSizeBytes: 1,
        totalBlocks: Number.POSITIVE_INFINITY,
        availableBlocks: 1,
      },
    ],
    [
      "negative infinity",
      {
        blockSizeBytes: 1,
        totalBlocks: 1,
        availableBlocks: Number.NEGATIVE_INFINITY,
      },
    ],
  ])("rejects %s filesystem values", async (_description, filesystemStats) => {
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({
        filesystemStats: () => Promise.resolve(filesystemStats),
      }),
    );

    await expect(reader.read()).rejects.toThrow("Invalid server health value");
  });

  it("rejects filesystem values whose byte products are unsafe", async () => {
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({
        filesystemStats: () =>
          Promise.resolve({
            blockSizeBytes: Number.MAX_SAFE_INTEGER,
            totalBlocks: 2,
            availableBlocks: 1,
          }),
      }),
    );

    await expect(reader.read()).rejects.toThrow("filesystem total capacity");
  });

  it("rejects available disk capacity greater than total capacity", async () => {
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({
        filesystemStats: () =>
          Promise.resolve({
            blockSizeBytes: 1_000,
            totalBlocks: 90,
            availableBlocks: 91,
          }),
      }),
    );

    await expect(reader.read()).rejects.toThrow(
      "filesystem available capacity exceeds total capacity",
    );
  });

  it("passes filesystem-reading failures through unchanged", async () => {
    const failure = new Error("filesystem unavailable");
    const reader = new NodeServerHealthReader(
      "/test-root",
      createDependencies({
        filesystemStats: async () => Promise.reject(failure),
      }),
    );

    await expect(reader.read()).rejects.toBe(failure);
  });
});
