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
import {
  registerAdministrativeWakeAlarmRoute,
  type AdministrativeWakeAlarmRouteDependencies,
} from "./administrative-wake-alarm-route.js";
import {
  registerAdministrativeShutdownRoutes,
  type AdministrativeShutdownRouteDependencies,
} from "./administrative-shutdown-route.js";

export interface CreateAppDependencies {
  logger: HttpErrorLogger;
  getServerHealth: GetServerHealthCapability;
  administrativeEventHistory?: AdministrativeEventHistoryRouteDependencies;
  administrativeWakeAlarm?: AdministrativeWakeAlarmRouteDependencies;
  administrativeShutdown?: AdministrativeShutdownRouteDependencies;
}

export function createApp({
  logger,
  getServerHealth,
  administrativeEventHistory,
  administrativeWakeAlarm,
  administrativeShutdown,
}: CreateAppDependencies): Express {
  const app = express();

  if (
    administrativeEventHistory !== undefined ||
    administrativeWakeAlarm !== undefined ||
    administrativeShutdown !== undefined
  ) {
    app.disable("etag");
    app.disable("x-powered-by");
  }
  if (administrativeEventHistory !== undefined) {
    registerAdministrativeEventHistoryRoute(app, administrativeEventHistory);
  }
  if (administrativeWakeAlarm !== undefined)
    registerAdministrativeWakeAlarmRoute(app, administrativeWakeAlarm);
  if (administrativeShutdown !== undefined)
    registerAdministrativeShutdownRoutes(app, administrativeShutdown);

  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/health/server", createServerHealthHandler(getServerHealth));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
