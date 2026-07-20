import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/http/create-app.js";

function createTestLogger() {
  return { error: vi.fn() };
}

describe("GET /health/live", () => {
  it("reports that the HTTP application is alive", async () => {
    const response = await request(createApp(createTestLogger())).get(
      "/health/live",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("unknown routes", () => {
  it("returns a stable not-found response", async () => {
    const logger = createTestLogger();
    const response = await request(createApp(logger)).get("/unknown");

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
