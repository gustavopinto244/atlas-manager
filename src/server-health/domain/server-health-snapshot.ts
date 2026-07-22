export interface ServerHealthSnapshot {
  readonly capturedAtIso: string;
  readonly uptimeSeconds: number;
  readonly totalMemoryBytes: number;
  readonly freeMemoryBytes: number;
  readonly usedMemoryBytes: number;
  readonly memoryUsagePercent: number;
  /** Dimensionless CPU load average measured over one minute. */
  readonly cpuLoadAverage1Minute: number;
  /** Dimensionless CPU load average measured over five minutes. */
  readonly cpuLoadAverage5Minutes: number;
  /** Dimensionless CPU load average measured over fifteen minutes. */
  readonly cpuLoadAverage15Minutes: number;
  readonly diskTotalBytes: number;
  readonly diskAvailableBytes: number;
  readonly diskUsedBytes: number;
  readonly diskUsagePercent: number;
}
