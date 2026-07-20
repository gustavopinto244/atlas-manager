import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";

import type { LogLevel } from "../config/environment.js";

interface HttpServerStartedContext {
  host: string;
  port: number;
}

export function createLogger(
  level: LogLevel,
  destination?: DestinationStream,
): PinoLogger {
  const options = { level };

  return destination === undefined ? pino(options) : pino(options, destination);
}

export function logHttpServerStarted(
  logger: PinoLogger,
  context: HttpServerStartedContext,
): void {
  logger.info(
    {
      event: "http_server_started",
      host: context.host,
      port: context.port,
    },
    "HTTP server started",
  );
}

export function logUnexpectedStartupFailure(
  logger: PinoLogger,
  error: unknown,
): void {
  logger.error(
    {
      event: "application_startup_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    },
    "Application startup failed",
  );
}
