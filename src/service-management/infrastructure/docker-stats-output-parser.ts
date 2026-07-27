import type { DockerContainerResourceUsage } from "../domain/docker-container-resource-usage.js";
import { createAvailableDockerContainerResourceUsage } from "../domain/docker-container-resource-usage.js";

export class DockerStatsOutputParserError extends Error {
  public constructor(
    public readonly code:
      | "invalid_json"
      | "invalid_cpu_percent"
      | "invalid_memory_usage"
      | "invalid_memory_limit"
      | "invalid_network_io"
      | "invalid_block_io"
      | "invalid_pids"
      | "missing_field",
    message?: string,
  ) {
    super(message ?? `Docker stats output parser failed: ${code}`);
    this.name = "DockerStatsOutputParserError";
    Object.freeze(this);
  }
}

export function parseDockerStatsOutput(
  output: string,
): DockerContainerResourceUsage {
  if (!output || output.trim() === "") {
    throw new DockerStatsOutputParserError("invalid_json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    throw new DockerStatsOutputParserError("invalid_json");
  }

  if (!isRecord(parsed)) {
    throw new DockerStatsOutputParserError("invalid_json");
  }

  if (typeof parsed.CPU !== "string") {
    throw new DockerStatsOutputParserError("invalid_cpu_percent");
  }
  const cpuPercent = parsePercentage(parsed.CPU);

  if (typeof parsed.MemUsage !== "string") {
    throw new DockerStatsOutputParserError("invalid_memory_usage");
  }
  const memoryUsageBytes = parseMemoryUsage(parsed.MemUsage);

  if (typeof parsed.MemPerc !== "string") {
    throw new DockerStatsOutputParserError("invalid_memory_limit");
  }
  const memoryLimitBytes = parseMemoryLimit(parsed.MemUsage);

  if (typeof parsed.NetIO !== "string") {
    throw new DockerStatsOutputParserError("invalid_network_io");
  }
  const { receive: networkReceiveBytes, transmit: networkTransmitBytes } =
    parseNetworkIO(parsed.NetIO);

  if (typeof parsed.BlockIO !== "string") {
    throw new DockerStatsOutputParserError("invalid_block_io");
  }
  const { read: blockReadBytes, write: blockWriteBytes } = parseBlockIO(
    parsed.BlockIO,
  );

  if (typeof parsed.PIDs !== "string") {
    throw new DockerStatsOutputParserError("invalid_pids");
  }
  const pids = parsePids(parsed.PIDs);

  return createAvailableDockerContainerResourceUsage({
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
    networkReceiveBytes,
    networkTransmitBytes,
    blockReadBytes,
    blockWriteBytes,
    pids,
  });
}

function parsePercentage(value: string): number {
  const trimmed = value.trim();
  if (!trimmed.endsWith("%")) {
    throw new DockerStatsOutputParserError("invalid_cpu_percent");
  }
  const numericPart = trimmed.slice(0, -1).trim();
  const parsed = Number(numericPart);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DockerStatsOutputParserError("invalid_cpu_percent");
  }
  return parsed;
}

function parseMemoryUsage(value: string): number {
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DockerStatsOutputParserError("invalid_memory_usage");
  }
  return parseQuantity(parts[0].trim(), "invalid_memory_usage");
}

function parseMemoryLimit(usageValue: string): number {
  const parts = usageValue.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DockerStatsOutputParserError("invalid_memory_limit");
  }
  const limitStr = parts[1].trim();
  return parseQuantity(limitStr, "invalid_memory_limit");
}

function parseNetworkIO(value: string): {
  receive: number;
  transmit: number;
} {
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DockerStatsOutputParserError("invalid_network_io");
  }
  const receive = parseQuantity(parts[0].trim(), "invalid_network_io");
  const transmit = parseQuantity(parts[1].trim(), "invalid_network_io");
  return { receive, transmit };
}

function parseBlockIO(value: string): { read: number; write: number } {
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DockerStatsOutputParserError("invalid_block_io");
  }
  const read = parseQuantity(parts[0].trim(), "invalid_block_io");
  const write = parseQuantity(parts[1].trim(), "invalid_block_io");
  return { read, write };
}

function parsePids(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "--") {
    throw new DockerStatsOutputParserError("invalid_pids");
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new DockerStatsOutputParserError("invalid_pids");
  }
  return parsed;
}

function parseQuantity(
  value: string,
  errorCode:
    | "invalid_memory_usage"
    | "invalid_memory_limit"
    | "invalid_network_io"
    | "invalid_block_io",
): number {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "--") {
    throw new DockerStatsOutputParserError(errorCode);
  }

  const match = trimmed.match(/^([0-9]*\.?[0-9]+)\s*([A-Za-z]+)?$/);
  if (!match) {
    throw new DockerStatsOutputParserError(errorCode);
  }

  const numericPart = match[1];
  const unitPart = match[2] ?? "B";

  const numericValue = Number(numericPart);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new DockerStatsOutputParserError(errorCode);
  }

  const multiplier = getUnitMultiplier(unitPart);
  const result = numericValue * multiplier;

  if (!Number.isFinite(result) || result < 0) {
    throw new DockerStatsOutputParserError(errorCode);
  }

  if (result > Number.MAX_SAFE_INTEGER) {
    throw new DockerStatsOutputParserError(errorCode);
  }

  return Math.round(result);
}

function getUnitMultiplier(unit: string): number {
  switch (unit) {
    case "B":
      return 1;
    case "kB":
      return 1000;
    case "MB":
      return 1000 * 1000;
    case "GB":
      return 1000 * 1000 * 1000;
    case "TB":
      return 1000 * 1000 * 1000 * 1000;
    case "KiB":
      return 1024;
    case "MiB":
      return 1024 * 1024;
    case "GiB":
      return 1024 * 1024 * 1024;
    case "TiB":
      return 1024 * 1024 * 1024 * 1024;
    default:
      throw new DockerStatsOutputParserError("invalid_memory_usage");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
