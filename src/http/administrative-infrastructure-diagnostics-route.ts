import type { Express, RequestHandler } from "express";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import { HttpError } from "./errors/http-error.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_ROUTE =
  "/admin/infrastructure/diagnostics";

const MAX_RESPONSE_BYTES = 64 * 1024;

export interface AdministrativeInfrastructureDiagnosticsRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => Readonly<{
    getInfrastructureDiagnostics: Readonly<{ execute(): Promise<unknown> }>;
  }>;
}

export function registerAdministrativeInfrastructureDiagnosticsRoute(
  app: Express,
  dependencies: AdministrativeInfrastructureDiagnosticsRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    ["infrastructure.diagnostics.read"],
    handler(dependencies),
  );
}

function handler(
  dependencies: AdministrativeInfrastructureDiagnosticsRouteDependencies,
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
    void (async () => {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
      }
      validateAdministrativeRequestTarget(request.url);
      rejectAdministrativeQuery(request.url);
      validateAdministrativeRequestHasNoBody(request);
      // The report aggregates its own per-check failures and always resolves.
      // A failing *check* must never become a failing *response* (ADR-032
      // §5.2): a 5xx here is reserved for this route being unable to answer at
      // all, and would otherwise hide the other checks that did succeed.
      const body = await dependencies
        .createProtectedAdministration(
          createCloudflareAccessAssertionReader(request),
        )
        .getInfrastructureDiagnostics.execute();
      const serialized = JSON.stringify(body);
      if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES)
        throw new HttpError(500, "internal_error", "Internal server error");
      response.status(200).type("application/json").send(serialized);
    })()
      .catch((error) => next(mapError(error)))
      .finally(release);
  };
}

function mapError(error: unknown): HttpError {
  return error instanceof HttpError
    ? error
    : (mapAdministrativeAccessControlError(error) ??
        new HttpError(
          503,
          "administrative_infrastructure_diagnostics_unavailable",
          "Administrative infrastructure diagnostics unavailable",
        ));
}
