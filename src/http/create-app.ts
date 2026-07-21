import express, { type Express } from "express";

import {
  createServerHealthHandler,
  type GetServerHealthCapability,
} from "../server-health/http/server-health-handler.js";
import {
  createErrorHandler,
  type HttpErrorLogger,
} from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";

interface CreateAppDependencies {
  logger: HttpErrorLogger;
  getServerHealth: GetServerHealthCapability;
}

export function createApp({
  logger,
  getServerHealth,
}: CreateAppDependencies): Express {
  const app = express();

  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/health/server", createServerHealthHandler(getServerHealth));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
