import type { ErrorRequestHandler } from "express";

import { HttpError } from "../errors/http-error.js";
import { setAdministrativeSecurityHeaders } from "../administrative-http.js";

export interface HttpErrorLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export function createErrorHandler(
  logger: HttpErrorLogger,
): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    void _next;

    if (error instanceof HttpError) {
      if (request.path.startsWith("/admin")) {
        setAdministrativeSecurityHeaders(response);
        logger.error(
          {
            event: "administrative_request_rejected",
            method: request.method,
            path: request.path,
            correlationId: response.getHeader("X-Atlas-Request-ID"),
            errorCode: error.code,
          },
          "Administrative request rejected",
        );
      }
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
        ...(request.path.startsWith("/admin")
          ? { correlationId: response.getHeader("X-Atlas-Request-ID") }
          : {}),
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
