export interface ServerHealthSnapshot {
  readonly capturedAtIso: string;
  readonly uptimeSeconds: number;
  readonly totalMemoryBytes: number;
  readonly freeMemoryBytes: number;
  readonly usedMemoryBytes: number;
  readonly memoryUsagePercent: number;
  /** System-wide CPU utilization measured as a percentage. */
  readonly cpuUsagePercent: number;
  /** Optional CPU package temperature reported in degrees Celsius. */
  readonly cpuTemperatureCelsius: number | null;
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
