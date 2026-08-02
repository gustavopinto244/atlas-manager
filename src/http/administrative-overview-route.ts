import type { Express, RequestHandler, Response } from "express";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import { HttpError } from "./errors/http-error.js";

export const ADMINISTRATIVE_OVERVIEW_ROUTE = "/admin/overview";

export interface ProtectedAdministrativeOverview {
  readonly getOperationsOverview: Readonly<{ execute(): Promise<unknown> }>;
}

export interface AdministrativeOverviewRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeOverview;
  readonly getServerHealth: Readonly<{ execute(): Promise<unknown> }>;
  readonly applicationVersion: string;
}

export function registerAdministrativeOverviewRoute(
  app: Express,
  dependencies: AdministrativeOverviewRouteDependencies,
): void {
  app.all(ADMINISTRATIVE_OVERVIEW_ROUTE, createHandler(dependencies));
}

function createHandler(
  dependencies: AdministrativeOverviewRouteDependencies,
): RequestHandler {
  return (request, response, next) => {
    setAdministrativeSecurityHeaders(response);
    const release = dependencies.admission.tryAdmit();
    if (release === undefined) {
      response.setHeader("Retry-After", "1");
      next(
        new HttpError(
          429,
          "administrative_request_limited",
          "Administrative request limit exceeded",
        ),
      );
      return;
    }
    void process(request, response, dependencies)
      .catch((error) => next(mapError(error)))
      .finally(release);
  };
}

async function process(
  request: Parameters<RequestHandler>[0],
  response: Response,
  dependencies: AdministrativeOverviewRouteDependencies,
): Promise<void> {
  if (request.path !== ADMINISTRATIVE_OVERVIEW_ROUTE)
    throw new HttpError(404, "route_not_found", "Route not found");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
  }
  validateAdministrativeRequestTarget(request.url);
  rejectAdministrativeQuery(request.url);
  validateAdministrativeRequestHasNoBody(request);
  const protectedAdministration = dependencies.createProtectedAdministration(
    createCloudflareAccessAssertionReader(request),
  );
  const [operations, server] = await Promise.all([
    protectedAdministration.getOperationsOverview.execute(),
    dependencies.getServerHealth.execute(),
  ]);
  send(response, {
    application: { version: dependencies.applicationVersion },
    runtime: {
      loopbackBinding: true,
      configurationProfile: "mock-administrative",
    },
    server,
    ...(typeof operations === "object" && operations !== null
      ? operations
      : {}),
    administration: {
      dashboardEnabled: true,
      serviceManagementEnabled: true,
      serviceAvailabilityEnabled: true,
      eventHistoryEnabled: true,
      overviewEnabled: true,
      wakeAlarmEnabled: false,
      shutdownEnabled: false,
    },
  });
}

function send(response: Response, value: unknown): void {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 262_144)
    throw new HttpError(500, "internal_error", "Internal server error");
  response.status(200).type("application/json").send(serialized);
}

function mapError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return (
    mapAdministrativeAccessControlError(error) ??
    new HttpError(
      503,
      "administrative_overview_unavailable",
      "Administrative overview unavailable",
    )
  );
}
