export type DockerContainerResourceUsage =
  | Readonly<{
      kind: "available";
      cpuPercent: number;
      memoryUsageBytes: number;
      memoryLimitBytes: number;
      networkReceiveBytes: number;
      networkTransmitBytes: number;
      blockReadBytes: number;
      blockWriteBytes: number;
      pids: number;
    }>
  | Readonly<{
      kind: "unavailable";
      reason: "container_not_running" | "stats_unavailable";
    }>;

export function createAvailableDockerContainerResourceUsage(params: {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  networkReceiveBytes: number;
  networkTransmitBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
}): DockerContainerResourceUsage {
  if (!Number.isFinite(params.cpuPercent) || params.cpuPercent < 0) {
    throw new Error("Invalid cpuPercent");
  }
  if (
    !Number.isFinite(params.memoryUsageBytes) ||
    params.memoryUsageBytes < 0
  ) {
    throw new Error("Invalid memoryUsageBytes");
  }
  if (
    !Number.isFinite(params.memoryLimitBytes) ||
    params.memoryLimitBytes < 0
  ) {
    throw new Error("Invalid memoryLimitBytes");
  }
  if (
    !Number.isFinite(params.networkReceiveBytes) ||
    params.networkReceiveBytes < 0
  ) {
    throw new Error("Invalid networkReceiveBytes");
  }
  if (
    !Number.isFinite(params.networkTransmitBytes) ||
    params.networkTransmitBytes < 0
  ) {
    throw new Error("Invalid networkTransmitBytes");
  }
  if (!Number.isFinite(params.blockReadBytes) || params.blockReadBytes < 0) {
    throw new Error("Invalid blockReadBytes");
  }
  if (!Number.isFinite(params.blockWriteBytes) || params.blockWriteBytes < 0) {
    throw new Error("Invalid blockWriteBytes");
  }
  if (!Number.isFinite(params.pids) || params.pids < 0) {
    throw new Error("Invalid pids");
  }
  if (!Number.isInteger(params.pids)) {
    throw new Error("pids must be an integer");
  }

  return Object.freeze({
    kind: "available",
    cpuPercent: params.cpuPercent,
    memoryUsageBytes: params.memoryUsageBytes,
    memoryLimitBytes: params.memoryLimitBytes,
    networkReceiveBytes: params.networkReceiveBytes,
    networkTransmitBytes: params.networkTransmitBytes,
    blockReadBytes: params.blockReadBytes,
    blockWriteBytes: params.blockWriteBytes,
    pids: params.pids,
  });
}

export function createUnavailableDockerContainerResourceUsage(
  reason: "container_not_running" | "stats_unavailable",
): DockerContainerResourceUsage {
  return Object.freeze({
    kind: "unavailable",
    reason,
  });
}
