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
import {
  registerAdministrativeBackupRoutes,
  type AdministrativeBackupsRouteDependencies,
} from "./administrative-backups-route.js";
import {
  registerAdministrativeEventHistoryOperationsRoutes,
  type AdministrativeEventHistoryOperationsRouteDependencies,
} from "./administrative-event-history-operations-route.js";
import {
  registerAdministrativeSecurityStatusRoute,
  type AdministrativeSecurityStatusRouteDependencies,
} from "./administrative-security-status-route.js";
import { createAdministrativeSecurityEnvelope } from "./administrative-security-envelope.js";
import type { AdministrativePublicOrigin } from "./administrative-public-origin.js";
import { validateAdministrativeRouteSecurityCatalog } from "./administrative-route-security-catalog.js";

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
  administrativeBackups?: AdministrativeBackupsRouteDependencies;
  administrativeEventHistoryOperations?: AdministrativeEventHistoryOperationsRouteDependencies;
  administrativeSecurityStatus?: AdministrativeSecurityStatusRouteDependencies;
  administrativePublicOrigin?: AdministrativePublicOrigin;
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
  administrativeBackups,
  administrativeEventHistoryOperations,
  administrativeSecurityStatus,
  administrativePublicOrigin,
}: CreateAppDependencies): Express {
  const app = express();
  app.set("trust proxy", false);
  validateAdministrativeRouteSecurityCatalog();

  if (
    administrativeEventHistory !== undefined ||
    administrativeWakeAlarm !== undefined ||
    administrativeShutdown !== undefined ||
    administrativeServices !== undefined ||
    administrativeServiceAvailability !== undefined ||
    administrativeOverview !== undefined ||
    administrativeDashboard !== undefined ||
    administrativeBackups !== undefined ||
    administrativeEventHistoryOperations !== undefined ||
    administrativeSecurityStatus !== undefined
  ) {
    app.disable("etag");
    app.disable("x-powered-by");
  }
  if (administrativePublicOrigin !== undefined)
    app.use(
      "/admin",
      createAdministrativeSecurityEnvelope({
        publicOrigin: administrativePublicOrigin,
      }),
    );
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
  if (administrativeBackups !== undefined)
    registerAdministrativeBackupRoutes(app, administrativeBackups);
  if (administrativeEventHistoryOperations !== undefined)
    registerAdministrativeEventHistoryOperationsRoutes(
      app,
      administrativeEventHistoryOperations,
    );
  if (administrativeSecurityStatus !== undefined)
    registerAdministrativeSecurityStatusRoute(
      app,
      administrativeSecurityStatus,
    );

  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/health/server", createServerHealthHandler(getServerHealth));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
