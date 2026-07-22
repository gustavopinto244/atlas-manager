import { cpus, freemem, loadavg, totalmem, uptime } from "node:os";
import { statfs } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

import type { ServerHealthReader } from "../application/ports/server-health-reader.js";
import type { ServerHealthSnapshot } from "../domain/server-health-snapshot.js";

export interface NodeServerHealthReaderDependencies {
  now(): Date;
  uptimeSeconds(): number;
  totalMemoryBytes(): number;
  freeMemoryBytes(): number;
  cpuLoadAverages(): readonly number[];
  cpuTimes(): readonly CpuTimes[];
  waitForCpuSample(): Promise<void>;
  filesystemStats(path: string): Promise<FilesystemStats>;
}

export interface CpuTimes {
  readonly user: number;
  readonly nice: number;
  readonly sys: number;
  readonly idle: number;
  readonly irq: number;
}

export interface FilesystemStats {
  readonly blockSizeBytes: number | bigint;
  readonly totalBlocks: number | bigint;
  readonly availableBlocks: number | bigint;
}

const nodeDependencies: NodeServerHealthReaderDependencies = {
  now: () => new Date(),
  uptimeSeconds: () => uptime(),
  totalMemoryBytes: () => totalmem(),
  freeMemoryBytes: () => freemem(),
  cpuLoadAverages: () => loadavg(),
  cpuTimes: () => cpus().map((cpu) => cpu.times),
  waitForCpuSample: () => setTimeout(100),
  filesystemStats: async (path) => {
    const statistics = await statfs(path, { bigint: true });

    return {
      blockSizeBytes: statistics.bsize,
      totalBlocks: statistics.blocks,
      availableBlocks: statistics.bavail,
    };
  },
};

/**
 * Reads host metrics from Node.js and rejects invalid or inconsistent source
 * values instead of silently normalizing them.
 */
export class NodeServerHealthReader implements ServerHealthReader {
  public constructor(
    private readonly filesystemPath: string,
    private readonly dependencies: NodeServerHealthReaderDependencies = nodeDependencies,
  ) {}

  public async read(): Promise<ServerHealthSnapshot> {
    const firstCpuSample = this.dependencies.cpuTimes();
    await this.dependencies.waitForCpuSample();
    const secondCpuSample = this.dependencies.cpuTimes();
    const filesystemStats = await this.dependencies.filesystemStats(
      this.filesystemPath,
    );

    return this.captureSnapshot(
      filesystemStats,
      firstCpuSample,
      secondCpuSample,
    );
  }

  private captureSnapshot(
    filesystemStats: FilesystemStats,
    firstCpuSample: readonly CpuTimes[],
    secondCpuSample: readonly CpuTimes[],
  ): ServerHealthSnapshot {
    const capturedAt = this.dependencies.now();

    if (!Number.isFinite(capturedAt.getTime())) {
      throw new Error("Invalid server health value: capture timestamp");
    }

    const uptimeSeconds = requireNonNegativeFiniteValue(
      this.dependencies.uptimeSeconds(),
      "uptime seconds",
    );
    const totalMemoryBytes = requireNonNegativeFiniteValue(
      this.dependencies.totalMemoryBytes(),
      "total memory bytes",
    );
    const freeMemoryBytes = requireNonNegativeFiniteValue(
      this.dependencies.freeMemoryBytes(),
      "free memory bytes",
    );

    if (freeMemoryBytes > totalMemoryBytes) {
      throw new Error(
        "Invalid server health value: free memory exceeds total memory",
      );
    }

    const cpuLoadAverages = this.dependencies.cpuLoadAverages();

    if (cpuLoadAverages.length !== 3) {
      throw new Error("Invalid server health value: CPU load averages");
    }

    const cpuLoadAverage1Minute = requireNonNegativeFiniteValue(
      cpuLoadAverages[0],
      "one-minute CPU load average",
    );
    const cpuLoadAverage5Minutes = requireNonNegativeFiniteValue(
      cpuLoadAverages[1],
      "five-minute CPU load average",
    );
    const cpuLoadAverage15Minutes = requireNonNegativeFiniteValue(
      cpuLoadAverages[2],
      "fifteen-minute CPU load average",
    );
    const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
    const memoryUsagePercent =
      totalMemoryBytes === 0 ? 0 : (usedMemoryBytes / totalMemoryBytes) * 100;
    const blockSizeBytes = requireNonNegativeSafeInteger(
      filesystemStats.blockSizeBytes,
      "filesystem block size",
    );
    const totalBlocks = requireNonNegativeSafeInteger(
      filesystemStats.totalBlocks,
      "filesystem total blocks",
    );
    const availableBlocks = requireNonNegativeSafeInteger(
      filesystemStats.availableBlocks,
      "filesystem available blocks",
    );
    const diskTotalBytes = requireSafeProduct(
      blockSizeBytes,
      totalBlocks,
      "filesystem total capacity",
    );
    const diskAvailableBytes = requireSafeProduct(
      blockSizeBytes,
      availableBlocks,
      "filesystem available capacity",
    );

    if (diskAvailableBytes > diskTotalBytes) {
      throw new Error(
        "Invalid server health value: filesystem available capacity exceeds total capacity",
      );
    }

    const diskUsedBytes = diskTotalBytes - diskAvailableBytes;
    const diskUsagePercent =
      diskTotalBytes === 0 ? 0 : (diskUsedBytes / diskTotalBytes) * 100;
    const cpuUsagePercent = calculateCpuUsagePercent(
      firstCpuSample,
      secondCpuSample,
    );

    return {
      capturedAtIso: capturedAt.toISOString(),
      uptimeSeconds,
      totalMemoryBytes,
      freeMemoryBytes,
      usedMemoryBytes,
      memoryUsagePercent,
      cpuUsagePercent,
      cpuLoadAverage1Minute,
      cpuLoadAverage5Minutes,
      cpuLoadAverage15Minutes,
      diskTotalBytes,
      diskAvailableBytes,
      diskUsedBytes,
      diskUsagePercent,
    };
  }
}

const CPU_TIME_FIELDS = ["user", "nice", "sys", "idle", "irq"] as const;

function calculateCpuUsagePercent(
  firstSample: readonly CpuTimes[],
  secondSample: readonly CpuTimes[],
): number {
  if (firstSample.length === 0 || secondSample.length === 0) {
    throw new Error("Invalid server health value: CPU samples are empty");
  }

  if (firstSample.length !== secondSample.length) {
    throw new Error("Invalid server health value: CPU sample sizes differ");
  }

  let totalDelta = 0;
  let idleDelta = 0;

  for (let cpuIndex = 0; cpuIndex < firstSample.length; cpuIndex += 1) {
    const firstTimes = firstSample[cpuIndex];
    const secondTimes = secondSample[cpuIndex];

    if (firstTimes === undefined || secondTimes === undefined) {
      throw new Error("Invalid server health value: CPU sample entry");
    }

    for (const field of CPU_TIME_FIELDS) {
      const firstValue = requireNonNegativeFiniteValue(
        firstTimes[field],
        `first CPU ${field} time`,
      );
      const secondValue = requireNonNegativeFiniteValue(
        secondTimes[field],
        `second CPU ${field} time`,
      );
      const delta = secondValue - firstValue;

      if (!Number.isFinite(delta) || delta < 0) {
        throw new Error(`Invalid server health value: CPU ${field} time delta`);
      }

      totalDelta += delta;

      if (field === "idle") {
        idleDelta += delta;
      }
    }
  }

  return calculateCpuUsagePercentFromDeltas(totalDelta, idleDelta);
}

/** @internal Validates aggregated CPU deltas before calculating utilization. */
export function calculateCpuUsagePercentFromDeltas(
  totalDelta: number,
  idleDelta: number,
): number {
  if (!Number.isFinite(totalDelta) || totalDelta <= 0) {
    throw new Error("Invalid server health value: CPU total time delta");
  }

  if (!Number.isFinite(idleDelta) || idleDelta < 0 || idleDelta > totalDelta) {
    throw new Error("Invalid server health value: CPU idle time delta");
  }

  const usagePercent = ((totalDelta - idleDelta) / totalDelta) * 100;

  if (
    !Number.isFinite(usagePercent) ||
    usagePercent < 0 ||
    usagePercent > 100
  ) {
    throw new Error("Invalid server health value: CPU usage percentage");
  }

  return usagePercent;
}

function requireNonNegativeSafeInteger(
  value: number | bigint,
  name: string,
): number {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Invalid server health value: ${name}`);
    }

    return Number(value);
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid server health value: ${name}`);
  }

  return value;
}

function requireSafeProduct(left: number, right: number, name: string): number {
  const product = left * right;

  if (!Number.isSafeInteger(product) || product < 0) {
    throw new Error(`Invalid server health value: ${name}`);
  }

  return product;
}

function requireNonNegativeFiniteValue(
  value: number | undefined,
  name: string,
): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid server health value: ${name}`);
  }

  return value;
}
