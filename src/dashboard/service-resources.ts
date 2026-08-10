// Compact, technology-neutral presentation of ServiceResourceObservation
// (src/service-management/domain/service-resource-observation.ts). The
// dashboard never computes or estimates resource values -- it only formats
// what the protected /admin/services/:id/resources endpoint already
// returned as authoritative.

export function formatCpuUsage(value: unknown): string {
  const record = asRecord(value);
  if (record === null) return "unavailable";
  if (record["outcome"] === "available") {
    const percent = record["usagePercent"];
    return typeof percent === "number" && Number.isFinite(percent)
      ? `${percent.toFixed(1)}%`
      : "unavailable";
  }
  return "unavailable";
}

export function formatMemoryUsage(value: unknown): string {
  const record = asRecord(value);
  if (record === null || record["outcome"] !== "available")
    return "unavailable";
  const usageBytes = record["usageBytes"];
  if (typeof usageBytes !== "number" || !Number.isFinite(usageBytes))
    return "unavailable";
  const limitBytes = record["limitBytes"];
  const usage = formatBytes(usageBytes);
  return typeof limitBytes === "number" && Number.isFinite(limitBytes)
    ? `${usage} / ${formatBytes(limitBytes)}`
    : usage;
}

export function formatUptime(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "unavailable";
  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(value)}s`;
}

export function resourceObservationSummary(value: unknown): string {
  const record = asRecord(value);
  if (record === null) return "Resources: unavailable";
  if (record["outcome"] !== "available") {
    const reason = record["reason"];
    return `Resources: ${typeof reason === "string" ? reason.replace(/_/gu, " ") : "unavailable"}`;
  }
  const cpu = formatCpuUsage(record["cpu"]);
  const memory = formatMemoryUsage(record["memory"]);
  const uptime = formatUptime(record["uptimeSeconds"]);
  return `CPU: ${cpu} · Memory: ${memory} · Uptime: ${uptime}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1_024;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
