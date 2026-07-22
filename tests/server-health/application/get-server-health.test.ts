import { describe, expect, it, vi } from "vitest";

import { GetServerHealth } from "../../../src/server-health/application/get-server-health.js";
import type { ServerHealthReader } from "../../../src/server-health/application/ports/server-health-reader.js";
import type { ServerHealthSnapshot } from "../../../src/server-health/domain/server-health-snapshot.js";

const snapshot: ServerHealthSnapshot = {
  capturedAtIso: "2026-07-21T02:00:00.000Z",
  uptimeSeconds: 86_400,
  totalMemoryBytes: 17_179_869_184,
  freeMemoryBytes: 6_442_450_944,
  usedMemoryBytes: 10_737_418_240,
  memoryUsagePercent: 62.5,
  cpuUsagePercent: 23.5,
  cpuTemperatureCelsius: 47.25,
  cpuLoadAverage1Minute: 0.75,
  cpuLoadAverage5Minutes: 0.5,
  cpuLoadAverage15Minutes: 0.25,
  diskTotalBytes: 240_000,
  diskAvailableBytes: 90_000,
  diskUsedBytes: 150_000,
  diskUsagePercent: 62.5,
};

describe("GetServerHealth", () => {
  it("retrieves the current snapshot through the reader port", async () => {
    const read = vi.fn().mockResolvedValue(snapshot);
    const reader: ServerHealthReader = {
      read,
    };
    const getServerHealth = new GetServerHealth(reader);

    await expect(getServerHealth.execute()).resolves.toBe(snapshot);
    expect(read).toHaveBeenCalledOnce();
  });

  it("propagates reader failures without translating them", async () => {
    const failure = new Error("health information is unavailable");
    const reader: ServerHealthReader = {
      read: vi.fn().mockRejectedValue(failure),
    };
    const getServerHealth = new GetServerHealth(reader);

    await expect(getServerHealth.execute()).rejects.toBe(failure);
  });
});
