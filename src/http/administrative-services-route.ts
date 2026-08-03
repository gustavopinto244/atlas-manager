import { isUtf8 } from "node:buffer";
import type { Express, Request, RequestHandler, Response } from "express";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import {
  AdministrativeAuditPartialEffectError,
  AdministrativeAuditTrailError,
} from "../event-history/application/administrative-audit-trail.js";
import { parseStrictJson } from "../config/strict-json.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import type { AdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import { HttpError } from "./errors/http-error.js";
import {
  mapAdministrativeServiceDetail,
  mapAdministrativeServiceList,
} from "./administrative-service-response.js";
import type { mapAdministrativeService } from "./administrative-service-response.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_SERVICES_ROUTE = "/admin/services";
export const ADMINISTRATIVE_SERVICE_MAX_BODY_BYTES = 512;
export const ADMINISTRATIVE_SERVICE_MAX_RESPONSE_BYTES = 262_144;

export interface ProtectedAdministrativeServices {
  readonly getRegisteredServices: Readonly<{ execute(): Promise<unknown> }>;
  readonly getRegisteredService: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly startRegisteredService: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly stopRegisteredService: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly restartRegisteredService: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
}

export interface AdministrativeServicesRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly mutationGate: AdministrativePowerOperationGate;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeServices;
}

export function registerAdministrativeServicesRoutes(
  app: Express,
  dependencies: AdministrativeServicesRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    ["services.list"],
    createServicesHandler(dependencies),
  );
  registerAdministrativeRoute(
    app,
    ["services.read"],
    createServiceHandler(dependencies),
  );
  for (const operation of ["start", "stop", "restart"] as const) {
    registerAdministrativeRoute(
      app,
      [`services.${operation}`],
      createAdministrativeServiceActionHandler(operation, dependencies),
    );
  }
}

function createServicesHandler(
  dependencies: AdministrativeServicesRouteDependencies,
): RequestHandler {
  return createAdmittedHandler(async (request, response) => {
    if (request.path !== ADMINISTRATIVE_SERVICES_ROUTE)
      throw new HttpError(404, "route_not_found", "Route not found");
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    const result = await dependencies
      .createProtectedAdministration(
        createCloudflareAccessAssertionReader(request),
      )
      .getRegisteredServices.execute();
    const values = result as readonly Readonly<{
      service: Parameters<typeof mapAdministrativeService>[0]["service"];
      status: Parameters<typeof mapAdministrativeService>[0]["status"];
      effectiveAvailability: string;
    }>[];
    sendBounded(response, mapAdministrativeServiceList(values));
  }, dependencies.admission);
}

function createServiceHandler(
  dependencies: AdministrativeServicesRouteDependencies,
): RequestHandler {
  return createAdmittedHandler(async (request, response) => {
    const serviceId = request.params.serviceId;
    if (typeof serviceId !== "string" || !isServiceId(serviceId))
      throw new HttpError(
        404,
        "registered_service_not_found",
        "Service not found",
      );
    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);
    const match = request.path.match(/^\/admin\/services\/([^/]+)$/u);
    if (match === null || decodeURIComponent(match[1]!) !== serviceId)
      throw new HttpError(404, "route_not_found", "Route not found");
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateAdministrativeRequestHasNoBody(request);
    const result = await dependencies
      .createProtectedAdministration(
        createCloudflareAccessAssertionReader(request),
      )
      .getRegisteredService.execute(serviceId);
    sendBounded(
      response,
      mapAdministrativeServiceDetail(
        result as Parameters<typeof mapAdministrativeServiceDetail>[0],
      ),
    );
  }, dependencies.admission);
}

export function createAdministrativeServiceActionHandler(
  operation: "start" | "stop" | "restart",
  dependencies: AdministrativeServicesRouteDependencies,
): RequestHandler {
  return createAdmittedHandler(async (request, response) => {
    const serviceId = request.params.serviceId;
    if (typeof serviceId !== "string" || !isServiceId(serviceId))
      throw new HttpError(
        404,
        "registered_service_not_found",
        "Service not found",
      );
    const expected = `${ADMINISTRATIVE_SERVICES_ROUTE}/${serviceId}/actions/${operation}`;
    if (request.path !== expected)
      throw new HttpError(404, "route_not_found", "Route not found");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);
    const body = await readStrictJsonBody(request);
    const confirmation = exactConfirmation(body, operation);
    const release = dependencies.mutationGate.tryAdmit();
    if (release === undefined)
      throw new HttpError(
        409,
        "administrative_service_operation_busy",
        "Service operation is busy",
      );
    try {
      void confirmation;
      const protectedAdministration =
        dependencies.createProtectedAdministration(
          createCloudflareAccessAssertionReader(request),
        );
      const result = await (operation === "start"
        ? protectedAdministration.startRegisteredService.execute(serviceId)
        : operation === "stop"
          ? protectedAdministration.stopRegisteredService.execute(serviceId)
          : protectedAdministration.restartRegisteredService.execute(
              serviceId,
            ));
      sendBounded(response, mapServiceOperationResult(result));
    } finally {
      release();
    }
  }, dependencies.admission);
}

function createAdmittedHandler(
  process: (request: Request, response: Response) => Promise<void>,
  admission: AdministrativeRequestAdmission,
): RequestHandler {
  return (request, response, next) => {
    setAdministrativeSecurityHeaders(response);
    const releaseAdmission = admission.tryAdmit();
    if (releaseAdmission === undefined) {
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
    void process(request, response)
      .catch((error) => next(mapServiceError(error)))
      .finally(releaseAdmission);
  };
}

async function readStrictJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (
    contentType !== "application/json" &&
    contentType !== "application/json; charset=utf-8"
  )
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Unsupported media type",
    );
  if (request.headers["content-encoding"] !== undefined)
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Unsupported media type",
    );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Uint8Array);
    size += value.byteLength;
    if (size > ADMINISTRATIVE_SERVICE_MAX_BODY_BYTES)
      throw new HttpError(413, "payload_too_large", "Payload too large");
    chunks.push(value);
  }
  const data = Buffer.concat(chunks);
  if (!data.length || !isUtf8(data))
    throw new HttpError(
      400,
      "invalid_administrative_service_request",
      "Invalid service request",
    );
  try {
    return parseStrictJson(data.toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_administrative_service_request",
      "Invalid service request",
    );
  }
}

function exactConfirmation(input: unknown, operation: string): string {
  const expected = `confirm_registered_service_${operation}`;
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new HttpError(
      400,
      "invalid_administrative_service_request",
      "Invalid service request",
    );
  const record = input as Record<string, unknown>;
  if (Reflect.ownKeys(record).length !== 1 || record.confirmation !== expected)
    throw new HttpError(
      400,
      "invalid_administrative_service_request",
      "Invalid service request",
    );
  return expected;
}

function mapServiceOperationResult(
  result: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof result !== "object" || result === null)
    return Object.freeze({ result: "completed" });
  const value = result as Record<string, unknown>;
  return Object.freeze({
    serviceId:
      typeof value.targetServiceId === "string"
        ? value.targetServiceId
        : undefined,
    operation:
      typeof value.requestedOperation === "string"
        ? value.requestedOperation
        : undefined,
    successful: value.successful === true,
  });
}

function sendBounded(response: Response, body: unknown): void {
  const serialized = JSON.stringify(body);
  if (
    Buffer.byteLength(serialized, "utf8") >
    ADMINISTRATIVE_SERVICE_MAX_RESPONSE_BYTES
  )
    throw new HttpError(500, "internal_error", "Internal server error");
  response.status(200).type("application/json").send(serialized);
}

function isServiceId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
  );
}

function mapServiceError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const access = mapAdministrativeAccessControlError(error);
  if (access !== undefined) return access;
  if (error instanceof AdministrativeAuditPartialEffectError)
    return new HttpError(
      503,
      "administrative_service_state_recheck_required",
      "Service state recheck required",
    );
  if (error instanceof AdministrativeAuditTrailError)
    return new HttpError(
      503,
      "administrative_event_history_unavailable",
      "Administrative event history unavailable",
    );
  if (
    error instanceof Error &&
    (error.message === "registered_service_not_found" ||
      (Object.hasOwn(error, "code") &&
        (error as Error & { code?: unknown }).code ===
          "registered_service_not_found"))
  )
    return new HttpError(
      404,
      "registered_service_not_found",
      "Service not found",
    );
  return new HttpError(
    503,
    "administrative_service_management_unavailable",
    "Service management unavailable",
  );
}
