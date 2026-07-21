import { freemem, loadavg, totalmem, uptime } from "node:os";

import type { ServerHealthReader } from "../application/ports/server-health-reader.js";
import type { ServerHealthSnapshot } from "../domain/server-health-snapshot.js";

export interface NodeServerHealthReaderDependencies {
  now(): Date;
  uptimeSeconds(): number;
  totalMemoryBytes(): number;
  freeMemoryBytes(): number;
  cpuLoadAverages(): readonly number[];
}

const nodeDependencies: NodeServerHealthReaderDependencies = {
  now: () => new Date(),
  uptimeSeconds: () => uptime(),
  totalMemoryBytes: () => totalmem(),
  freeMemoryBytes: () => freemem(),
  cpuLoadAverages: () => loadavg(),
};

/**
 * Reads host metrics from Node.js and rejects invalid or inconsistent source
 * values instead of silently normalizing them.
 */
export class NodeServerHealthReader implements ServerHealthReader {
  public constructor(
    private readonly dependencies: NodeServerHealthReaderDependencies = nodeDependencies,
  ) {}

  public read(): Promise<ServerHealthSnapshot> {
    return Promise.resolve().then(() => this.captureSnapshot());
  }

  private captureSnapshot(): ServerHealthSnapshot {
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

    return {
      capturedAtIso: capturedAt.toISOString(),
      uptimeSeconds,
      totalMemoryBytes,
      freeMemoryBytes,
      usedMemoryBytes,
      memoryUsagePercent,
      cpuLoadAverage1Minute,
      cpuLoadAverage5Minutes,
      cpuLoadAverage15Minutes,
    };
  }
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
