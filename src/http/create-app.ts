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
import {
  registerAdministrativeServicesRoutes,
  type AdministrativeServicesRouteDependencies,
} from "./administrative-services-route.js";
import {
  registerAdministrativeServiceAvailabilityRoutes,
  type AdministrativeServiceAvailabilityRouteDependencies,
} from "./administrative-service-availability-route.js";
import {
  registerAdministrativeOverviewRoute,
  type AdministrativeOverviewRouteDependencies,
} from "./administrative-overview-route.js";
import {
  registerAdministrativeDashboardRoutes,
  type AdministrativeDashboardRouteDependencies,
} from "./administrative-dashboard-route.js";

export interface CreateAppDependencies {
  logger: HttpErrorLogger;
  getServerHealth: GetServerHealthCapability;
  administrativeEventHistory?: AdministrativeEventHistoryRouteDependencies;
  administrativeWakeAlarm?: AdministrativeWakeAlarmRouteDependencies;
  administrativeShutdown?: AdministrativeShutdownRouteDependencies;
  administrativeServices?: AdministrativeServicesRouteDependencies;
  administrativeServiceAvailability?: AdministrativeServiceAvailabilityRouteDependencies;
  administrativeOverview?: AdministrativeOverviewRouteDependencies;
  administrativeDashboard?: AdministrativeDashboardRouteDependencies;
}

export function createApp({
  logger,
  getServerHealth,
  administrativeEventHistory,
  administrativeWakeAlarm,
  administrativeShutdown,
  administrativeServices,
  administrativeServiceAvailability,
  administrativeOverview,
  administrativeDashboard,
}: CreateAppDependencies): Express {
  const app = express();

  if (
    administrativeEventHistory !== undefined ||
    administrativeWakeAlarm !== undefined ||
    administrativeShutdown !== undefined ||
    administrativeServices !== undefined ||
    administrativeServiceAvailability !== undefined ||
    administrativeOverview !== undefined ||
    administrativeDashboard !== undefined
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
  if (administrativeServices !== undefined)
    registerAdministrativeServicesRoutes(app, administrativeServices);
  if (administrativeServiceAvailability !== undefined)
    registerAdministrativeServiceAvailabilityRoutes(
      app,
      administrativeServiceAvailability,
    );
  if (administrativeOverview !== undefined)
    registerAdministrativeOverviewRoute(app, administrativeOverview);
  if (administrativeDashboard !== undefined)
    registerAdministrativeDashboardRoutes(app, administrativeDashboard);

  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/health/server", createServerHealthHandler(getServerHealth));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
