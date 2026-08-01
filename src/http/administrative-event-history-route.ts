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
import {
  ADMINISTRATIVE_MAX_REQUEST_TARGET_BYTES,
  mapAdministrativeAccessControlError,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";

export const ADMINISTRATIVE_EVENT_HISTORY_ROUTE = "/admin/event-history";
export const ADMINISTRATIVE_EVENT_HISTORY_MAX_URL_BYTES =
  ADMINISTRATIVE_MAX_REQUEST_TARGET_BYTES;
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
    validateAdministrativeRequestTarget(request.url);
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
  const accessError = mapAdministrativeAccessControlError(error);
  if (accessError !== undefined) {
    if (
      error instanceof AdministrativeAccessControlError &&
      error.code === "protected_operation_failed"
    )
      return new HttpError(
        503,
        "administrative_event_history_unavailable",
        "Administrative event history unavailable",
      );
    return accessError;
  }
  return new HttpError(500, "internal_error", "Internal server error");
}
