import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../../src/http/create-app.js";
import type { ServerHealthSnapshot } from "../../../src/server-health/domain/server-health-snapshot.js";

const snapshot: ServerHealthSnapshot = {
  capturedAtIso: "2026-07-20T12:00:00.000Z",
  uptimeSeconds: 7_200,
  totalMemoryBytes: 8_000_000_000,
  freeMemoryBytes: 2_000_000_000,
  usedMemoryBytes: 6_000_000_000,
  memoryUsagePercent: 75,
  cpuUsagePercent: 23.5,
  cpuLoadAverage1Minute: 0.42,
  cpuLoadAverage5Minutes: 0.31,
  cpuLoadAverage15Minutes: 0.24,
  diskTotalBytes: 240_000,
  diskAvailableBytes: 90_000,
  diskUsedBytes: 150_000,
  diskUsagePercent: 62.5,
};

describe("GET /health/server", () => {
  it("returns the complete server-health response as JSON", async () => {
    const execute = vi.fn().mockResolvedValue(snapshot);
    const app = createApp({
      logger: { error: vi.fn() },
      getServerHealth: { execute },
    });

    const response = await request(app).get("/health/server");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json\b/);
    expect(response.body).toEqual({
      capturedAt: "2026-07-20T12:00:00.000Z",
      uptimeSeconds: 7_200,
      memory: {
        totalBytes: 8_000_000_000,
        freeBytes: 2_000_000_000,
        usedBytes: 6_000_000_000,
        usagePercentage: 75,
      },
      cpu: {
        usagePercentage: 23.5,
      },
      cpuLoadAverage: {
        oneMinute: 0.42,
        fiveMinutes: 0.31,
        fifteenMinutes: 0.24,
      },
      disk: {
        totalBytes: 240_000,
        availableBytes: 90_000,
        usedBytes: 150_000,
        usagePercentage: 62.5,
      },
    });
    const responseText = JSON.stringify(response.body);

    for (const rawCpuDetail of [
      "model",
      "speed",
      "user",
      "nice",
      "sys",
      "idle",
      "irq",
    ]) {
      expect(responseText).not.toContain(`"${rawCpuDetail}"`);
    }
    expect(execute).toHaveBeenCalledOnce();
  });

  it("converts failures into a safe response and structured event", async () => {
    const failure = new Error("credential leaked at /private/internal/path");
    const execute = vi.fn().mockRejectedValue(failure);
    const logError = vi.fn();
    const app = createApp({
      logger: { error: logError },
      getServerHealth: { execute },
    });

    const response = await request(app)
      .get("/health/server?token=secret")
      .set("authorization", "Bearer secret");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    });
    expect(logError).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(
      {
        event: "http_request_failed",
        method: "GET",
        path: "/health/server",
        errorType: "Error",
      },
      "HTTP request failed",
    );

    const responseText = JSON.stringify(response.body);
    const logText = JSON.stringify(logError.mock.calls);

    for (const unsafeValue of [
      "credential leaked",
      "/private/internal/path",
      "Bearer secret",
      "token=secret",
    ]) {
      expect(responseText).not.toContain(unsafeValue);
      expect(logText).not.toContain(unsafeValue);
    }
  });
});
