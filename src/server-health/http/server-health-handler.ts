import type { RequestHandler } from "express";

import type { ServerHealthSnapshot } from "../domain/server-health-snapshot.js";

export interface GetServerHealthCapability {
  execute(): Promise<ServerHealthSnapshot>;
}

export function createServerHealthHandler(
  getServerHealth: GetServerHealthCapability,
): RequestHandler {
  return async (_request, response) => {
    const snapshot = await getServerHealth.execute();

    response.status(200).json({
      capturedAt: snapshot.capturedAtIso,
      uptimeSeconds: snapshot.uptimeSeconds,
      memory: {
        totalBytes: snapshot.totalMemoryBytes,
        freeBytes: snapshot.freeMemoryBytes,
        usedBytes: snapshot.usedMemoryBytes,
        usagePercentage: snapshot.memoryUsagePercent,
      },
      cpu: {
        usagePercentage: snapshot.cpuUsagePercent,
        temperatureCelsius: snapshot.cpuTemperatureCelsius,
      },
      cpuLoadAverage: {
        oneMinute: snapshot.cpuLoadAverage1Minute,
        fiveMinutes: snapshot.cpuLoadAverage5Minutes,
        fifteenMinutes: snapshot.cpuLoadAverage15Minutes,
      },
      disk: {
        totalBytes: snapshot.diskTotalBytes,
        availableBytes: snapshot.diskAvailableBytes,
        usedBytes: snapshot.diskUsedBytes,
        usagePercentage: snapshot.diskUsagePercent,
      },
    });
  };
}
