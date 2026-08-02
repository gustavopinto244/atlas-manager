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

export const ADMINISTRATIVE_SECURITY_STATUS_ROUTE = "/admin/security/status";
export interface AdministrativeSecurityStatusRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => Readonly<{
    getAdministrativeSecurityPosture: Readonly<{ execute(): Promise<unknown> }>;
  }>;
}

export function registerAdministrativeSecurityStatusRoute(
  app: Express,
  dependencies: AdministrativeSecurityStatusRouteDependencies,
): void {
  app.all(ADMINISTRATIVE_SECURITY_STATUS_ROUTE, handler(dependencies));
}

function handler(
  dependencies: AdministrativeSecurityStatusRouteDependencies,
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
      const body = await dependencies
        .createProtectedAdministration(
          createCloudflareAccessAssertionReader(request),
        )
        .getAdministrativeSecurityPosture.execute();
      const serialized = JSON.stringify(body);
      if (Buffer.byteLength(serialized, "utf8") > 64 * 1024)
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
          "administrative_security_status_unavailable",
          "Administrative security status unavailable",
        ));
}
