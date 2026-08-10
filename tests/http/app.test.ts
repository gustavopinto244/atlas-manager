import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/http/create-app.js";

function createTestLogger() {
  return { error: vi.fn() };
}

function createTestApp(logger = createTestLogger()) {
  return createApp({
    logger,
    getServerHealth: {
      execute: vi.fn(),
    },
  });
}

describe("GET /health/live", () => {
  it("reports that the HTTP application is alive", async () => {
    const response = await request(createTestApp()).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("health endpoint hardening", () => {
  // Health stays unauthenticated for local supervision, so the headers are the
  // only thing standing between a misrouted proxy and a cached or framed copy
  // of the host metrics.
  const hardened: readonly (readonly [string, string])[] = [
    ["cache-control", "no-store, private"],
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "no-referrer"],
  ];

  it("hardens the liveness endpoint", async () => {
    const response = await request(createTestApp()).get("/health/live");
    for (const [header, value] of hardened)
      expect(response.headers[header], header).toBe(value);
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
  });

  it("hardens the host metrics endpoint", async () => {
    const app = createApp({
      logger: createTestLogger(),
      getServerHealth: {
        execute: vi.fn(async () => ({
          capturedAtIso: "2026-08-09T00:00:00.000Z",
          uptimeSeconds: 1,
          totalMemoryBytes: 1,
          freeMemoryBytes: 1,
          usedMemoryBytes: 0,
          memoryUsagePercent: 0,
          cpuUsagePercent: 0,
          cpuTemperatureCelsius: null,
          cpuLoadAverage1Minute: 0,
          cpuLoadAverage5Minutes: 0,
          cpuLoadAverage15Minutes: 0,
          diskTotalBytes: 1,
          diskAvailableBytes: 1,
          diskUsedBytes: 0,
          diskUsagePercent: 0,
        })),
      },
    });
    const response = await request(app).get("/health/server");
    expect(response.status).toBe(200);
    for (const [header, value] of hardened)
      expect(response.headers[header], header).toBe(value);
  });

  it("keeps health reachable without administrative credentials", async () => {
    const response = await request(createTestApp()).get("/health/live");
    expect(response.status).toBe(200);
  });
});

describe("unknown routes", () => {
  it("returns a stable not-found response", async () => {
    const logger = createTestLogger();
    const response = await request(createTestApp(logger)).get("/unknown");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "route_not_found",
        message: "Route not found",
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
