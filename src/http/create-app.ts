import express, { type Express, type RequestHandler } from "express";

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
  registerAdministrativeServiceScheduleRoutes,
  type AdministrativeServiceScheduleRouteDependencies,
} from "./administrative-service-schedule-route.js";
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
import { setAdministrativeSecurityHeaders } from "./administrative-http.js";
import type { AdministrativePublicOrigin } from "./administrative-public-origin.js";
import {
  expectedAdministrativeRouteIds,
  reconcileAdministrativeRouteRegistrations,
  validateAdministrativeRouteSecurityCatalog,
} from "./administrative-route-security-catalog.js";

export interface CreateAppDependencies {
  logger: HttpErrorLogger;
  getServerHealth: GetServerHealthCapability;
  administrativeEventHistory?: AdministrativeEventHistoryRouteDependencies;
  administrativeWakeAlarm?: AdministrativeWakeAlarmRouteDependencies;
  administrativeShutdown?: AdministrativeShutdownRouteDependencies;
  administrativeServices?: AdministrativeServicesRouteDependencies;
  administrativeServiceAvailability?: AdministrativeServiceAvailabilityRouteDependencies;
  administrativeServiceSchedule?: AdministrativeServiceScheduleRouteDependencies;
  administrativeOverview?: AdministrativeOverviewRouteDependencies;
  administrativeDashboard?: AdministrativeDashboardRouteDependencies;
  administrativeBackups?: AdministrativeBackupsRouteDependencies;
  administrativeEventHistoryOperations?: AdministrativeEventHistoryOperationsRouteDependencies;
  administrativeSecurityStatus?: AdministrativeSecurityStatusRouteDependencies;
  administrativePublicOrigin?: AdministrativePublicOrigin;
  administrativeRouteCatalogStatus?: Readonly<{
    markReconciled(): void;
  }>;
}

export function createApp({
  logger,
  getServerHealth,
  administrativeEventHistory,
  administrativeWakeAlarm,
  administrativeShutdown,
  administrativeServices,
  administrativeServiceAvailability,
  administrativeServiceSchedule,
  administrativeOverview,
  administrativeDashboard,
  administrativeBackups,
  administrativeEventHistoryOperations,
  administrativeSecurityStatus,
  administrativePublicOrigin,
  administrativeRouteCatalogStatus,
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
    administrativeServiceSchedule !== undefined ||
    administrativeOverview !== undefined ||
    administrativeDashboard !== undefined ||
    administrativeBackups !== undefined ||
    administrativeEventHistoryOperations !== undefined ||
    administrativeSecurityStatus !== undefined
  ) {
    app.disable("etag");
    app.disable("x-powered-by");
  }
  if (administrativePublicOrigin !== undefined) {
    const envelope = createAdministrativeSecurityEnvelope({
      publicOrigin: administrativePublicOrigin,
    });
    app.use((request, response, next) => {
      if (
        request.path === "/" ||
        request.path.startsWith("/assets/") ||
        request.path.startsWith("/admin")
      )
        return envelope(request, response, next);
      next();
    });
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
  if (administrativeServiceSchedule !== undefined)
    registerAdministrativeServiceScheduleRoutes(
      app,
      administrativeServiceSchedule,
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

  reconcileAdministrativeRouteRegistrations(
    app,
    expectedAdministrativeRouteIds([
      ...(administrativeDashboard === undefined
        ? []
        : ["ADMINISTRATIVE_DASHBOARD_ENABLED"]),
      ...(administrativeEventHistory === undefined
        ? []
        : ["ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED"]),
      ...(administrativeEventHistoryOperations === undefined
        ? []
        : ["ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED"]),
      ...(administrativeWakeAlarm === undefined
        ? []
        : ["ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED"]),
      ...(administrativeShutdown === undefined
        ? []
        : ["ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED"]),
      ...(administrativeServices === undefined
        ? []
        : ["ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED"]),
      ...(administrativeServiceAvailability === undefined
        ? []
        : ["ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED"]),
      ...(administrativeServiceSchedule === undefined
        ? []
        : ["ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY"]),
      ...(administrativeOverview === undefined
        ? []
        : ["ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED"]),
      ...(administrativeBackups === undefined
        ? []
        : ["ADMINISTRATIVE_BACKUP_HTTP_ENABLED"]),
      ...(administrativeSecurityStatus === undefined
        ? []
        : ["ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED"]),
    ]),
  );
  administrativeRouteCatalogStatus?.markReconciled();

  // Health endpoints stay unauthenticated on purpose: the documented local curl
  // checks and any local supervision depend on them, and the process is bound to
  // the loopback interface whenever administration is enabled. They deliberately
  // do not get the administrative envelope, whose Host and Origin checks would
  // reject a loopback request against the public administrative origin.
  //
  // They do get the same hardening headers, so /health/server — which reports
  // host memory, CPU, temperature, load and disk — cannot be cached, framed or
  // content-sniffed if a proxy ever exposes it by mistake. Keeping it off the
  // public server block is the reverse proxy's job; see
  // docs/operations/atlas-manager-nginx.md.
  const healthHeaders: RequestHandler = (_request, response, next) => {
    setAdministrativeSecurityHeaders(response);
    next();
  };
  app.get("/health/live", healthHeaders, (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get(
    "/health/server",
    healthHeaders,
    createServerHealthHandler(getServerHealth),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
