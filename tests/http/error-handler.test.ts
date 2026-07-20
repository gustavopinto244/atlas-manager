import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../src/http/errors/http-error.js";
import {
  createErrorHandler,
  type HttpErrorLogger,
} from "../../src/http/middleware/error-handler.js";
import { notFoundHandler } from "../../src/http/middleware/not-found.js";

function createTestApp(routeHandler: RequestHandler, logger: HttpErrorLogger) {
  const app = express();

  app.get("/test", routeHandler);
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}

describe("HTTP error handling", () => {
  it("returns the explicitly defined response for a known HTTP error", async () => {
    const logger = { error: vi.fn() };
    const app = createTestApp(() => {
      throw new HttpError(422, "invalid_request", "The request is invalid");
    }, logger);

    const response = await request(app).get("/test");

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid",
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([399, 600, 400.5, Number.NaN])(
    "rejects the unsupported status %s",
    (statusCode) => {
      expect(
        () => new HttpError(statusCode, "invalid", "Invalid status"),
      ).toThrow(RangeError);
    },
  );

  it("returns a generic response and safely logs an unexpected error", async () => {
    const logger = { error: vi.fn() };
    const app = createTestApp(() => {
      throw new Error("credential leaked at /private/internal/path");
    }, logger);

    const response = await request(app)
      .get("/test?token=secret")
      .set("authorization", "Bearer secret")
      .set("cookie", "session=secret");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "http_request_failed",
        method: "GET",
        path: "/test",
        errorType: "Error",
      },
      "HTTP request failed",
    );

    const responseText = JSON.stringify(response.body);
    const logText = JSON.stringify(logger.error.mock.calls);

    for (const unsafeValue of [
      "credential leaked",
      "/private/internal/path",
      "Bearer secret",
      "session=secret",
      "token=secret",
    ]) {
      expect(responseText).not.toContain(unsafeValue);
      expect(logText).not.toContain(unsafeValue);
    }
  });
});
