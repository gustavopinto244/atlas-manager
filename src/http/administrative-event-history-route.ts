import type { Express, RequestHandler, Response } from "express";

import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import { AdministrativeAccessControlError } from "../access-control/application/errors.js";
import type { AdministrativeEventHistoryPage } from "../event-history/domain/administrative-event-history-page.js";
import { HttpError } from "./errors/http-error.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import {
  parseAdministrativeEventHistoryQuery,
  AdministrativeEventHistoryQueryParseError,
} from "./administrative-event-history-query-parser.js";
import {
  mapAdministrativeEventHistoryResponse,
  type AdministrativeEventHistoryHttpResponse,
} from "./administrative-event-history-response.js";

export const ADMINISTRATIVE_EVENT_HISTORY_ROUTE = "/admin/event-history";
export const ADMINISTRATIVE_EVENT_HISTORY_MAX_URL_BYTES = 4_096;
export const ADMINISTRATIVE_EVENT_HISTORY_MAX_RESPONSE_BYTES = 1_048_576;

export interface ProtectedAdministrativeEventHistoryQuery {
  execute(input: unknown): Promise<AdministrativeEventHistoryPage>;
}

export interface AdministrativeEventHistoryRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly createProtectedEventHistoryQuery: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeEventHistoryQuery;
}

export function registerAdministrativeEventHistoryRoute(
  app: Express,
  dependencies: AdministrativeEventHistoryRouteDependencies,
): void {
  app.all(
    ADMINISTRATIVE_EVENT_HISTORY_ROUTE,
    createAdministrativeEventHistoryHandler(dependencies),
  );
}

export function createAdministrativeEventHistoryHandler(
  dependencies: AdministrativeEventHistoryRouteDependencies,
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

    void processRequest(request, response, next, dependencies).finally(release);
  };
}

async function processRequest(
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
  dependencies: AdministrativeEventHistoryRouteDependencies,
): Promise<void> {
  try {
    if (request.path !== ADMINISTRATIVE_EVENT_HISTORY_ROUTE)
      throw new HttpError(404, "route_not_found", "Route not found");
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateRequestTarget(request.url);
    validateRequestBody(request);
    const query = parseAdministrativeEventHistoryQuery(request.url);
    const reader = createAssertionReader(request);
    const protectedQuery =
      dependencies.createProtectedEventHistoryQuery(reader);
    const page = await protectedQuery.execute(query);
    const body = mapAdministrativeEventHistoryResponse(page);
    sendBoundedResponse(response, body);
  } catch (error) {
    next(mapAdministrativeEventHistoryError(error));
  }
}

function createAssertionReader(
  request: Parameters<RequestHandler>[0],
): CloudflareAccessAssertionReader {
  return createCloudflareAccessAssertionReader(request);
}

function validateRequestTarget(requestTarget: string): void {
  if (
    Buffer.byteLength(requestTarget, "utf8") >
    ADMINISTRATIVE_EVENT_HISTORY_MAX_URL_BYTES
  )
    throw new HttpError(414, "uri_too_long", "URI Too Long");
}

function validateRequestBody(request: Parameters<RequestHandler>[0]): void {
  const contentLength = request.headers["content-length"];
  const transferEncoding = request.headers["transfer-encoding"];
  if (
    transferEncoding !== undefined ||
    Array.isArray(contentLength) ||
    (contentLength !== undefined && contentLength !== "0")
  )
    throw new HttpError(
      400,
      "invalid_administrative_request",
      "Invalid administrative request",
    );
}

function sendBoundedResponse(
  response: Response,
  body: AdministrativeEventHistoryHttpResponse,
): void {
  const serialized = JSON.stringify(body);
  if (
    Buffer.byteLength(serialized, "utf8") >
    ADMINISTRATIVE_EVENT_HISTORY_MAX_RESPONSE_BYTES
  )
    throw new HttpError(500, "internal_error", "Internal server error");
  response.status(200).type("application/json").send(serialized);
}

function mapAdministrativeEventHistoryError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof AdministrativeEventHistoryQueryParseError)
    return new HttpError(
      400,
      "invalid_administrative_event_history_query",
      "Invalid administrative event-history query",
    );
  if (error instanceof AdministrativeAccessControlError) {
    if (error.code === "administrative_authentication_required")
      return new HttpError(
        401,
        "administrative_authentication_required",
        "Administrative authentication required",
      );
    if (error.code === "administrative_authorization_denied")
      return new HttpError(
        403,
        "administrative_authorization_denied",
        "Administrative authorization denied",
      );
    if (error.code === "administrative_identity_unavailable")
      return new HttpError(
        503,
        "administrative_identity_unavailable",
        "Administrative identity unavailable",
      );
    if (error.code === "authorization_audit_unavailable")
      return new HttpError(
        503,
        "authorization_audit_unavailable",
        "Authorization audit unavailable",
      );
    if (error.code === "protected_operation_failed")
      return new HttpError(
        503,
        "administrative_event_history_unavailable",
        "Administrative event history unavailable",
      );
    return new HttpError(
      503,
      "administrative_authorization_unavailable",
      "Administrative authorization unavailable",
    );
  }
  return new HttpError(500, "internal_error", "Internal server error");
}

function setAdministrativeSecurityHeaders(response: Response): void {
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
}
