import type { ErrorRequestHandler } from "express";

import { HttpError } from "../errors/http-error.js";

export interface HttpErrorLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export function createErrorHandler(
  logger: HttpErrorLogger,
): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    void _next;

    if (error instanceof HttpError) {
      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    logger.error(
      {
        event: "http_request_failed",
        method: request.method,
        path: request.path,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "HTTP request failed",
    );

    response.status(500).json({
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    });
  };
}
