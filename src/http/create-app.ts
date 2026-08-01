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
import {
  registerAdministrativeEventHistoryRoute,
  type AdministrativeEventHistoryRouteDependencies,
} from "./administrative-event-history-route.js";

export interface CreateAppDependencies {
  logger: HttpErrorLogger;
  getServerHealth: GetServerHealthCapability;
  administrativeEventHistory?: AdministrativeEventHistoryRouteDependencies;
}

export function createApp({
  logger,
  getServerHealth,
  administrativeEventHistory,
}: CreateAppDependencies): Express {
  const app = express();

  if (administrativeEventHistory !== undefined) {
    app.disable("etag");
    app.disable("x-powered-by");
    registerAdministrativeEventHistoryRoute(app, administrativeEventHistory);
  }

  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/health/server", createServerHealthHandler(getServerHealth));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
