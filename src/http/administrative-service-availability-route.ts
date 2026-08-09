import type { Express, Request, RequestHandler, Response } from "express";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import { AdministrativeAccessControlError } from "../access-control/application/errors.js";
import { parseStrictJson } from "../config/strict-json.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import type { AdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import { HttpError } from "./errors/http-error.js";
import { mapAdministrativeAvailability } from "./administrative-service-response.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_SERVICE_AVAILABILITY_ROUTE =
  "/admin/services/:serviceId/availability";
const MAX_BODY_BYTES = 4_096;

export interface ProtectedAdministrativeServiceAvailability {
  readonly getRegisteredServiceAvailability: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly getRegisteredServiceAvailabilityPreview: Readonly<{
    execute(
      serviceId: string,
      input: { readonly startsAt: string; readonly endsAt: string },
    ): Promise<unknown>;
  }>;
  readonly setRegisteredServiceAvailability: Readonly<{
    execute(serviceId: string, input: unknown): Promise<unknown>;
  }>;
  readonly removeRegisteredServiceAvailability: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
}

export interface AdministrativeServiceAvailabilityRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly mutationGate: AdministrativePowerOperationGate;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeServiceAvailability;
}

export function registerAdministrativeServiceAvailabilityRoutes(
  app: Express,
  dependencies: AdministrativeServiceAvailabilityRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    [
      "services.availability.read",
      "services.availability.update",
      "services.availability.delete",
    ],
    createAvailabilityHandler(dependencies),
  );
  registerAdministrativeRoute(
    app,
    ["services.availability.preview"],
    createAvailabilityPreviewHandler(dependencies),
  );
}

function createAvailabilityPreviewHandler(
  dependencies: AdministrativeServiceAvailabilityRouteDependencies,
): RequestHandler {
  return (request, response, next) => {
    setAdministrativeSecurityHeaders(response);
    const releaseAdmission = dependencies.admission.tryAdmit();
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
    void processAvailabilityPreview(request, response, dependencies)
      .catch((error) => next(mapAvailabilityError(error)))
      .finally(releaseAdmission);
  };
}

async function processAvailabilityPreview(
  request: Request,
  response: Response,
  dependencies: AdministrativeServiceAvailabilityRouteDependencies,
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
  }
  const serviceId = request.params.serviceId;
  if (typeof serviceId !== "string" || !isServiceId(serviceId))
    throw new HttpError(
      404,
      "registered_service_not_found",
      "Service not found",
    );
  validateAdministrativeRequestTarget(request.url);
  validateAdministrativeRequestHasNoBody(request);
  const query = new URL(request.url, "http://atlas.invalid").searchParams;
  const keys = [...query.keys()];
  if (
    keys.length !== 2 ||
    new Set(keys).size !== 2 ||
    !keys.includes("startsAt") ||
    !keys.includes("endsAt")
  )
    throw new HttpError(
      400,
      "invalid_service_availability_request",
      "Invalid availability preview request",
    );
  const startsAt = query.get("startsAt");
  const endsAt = query.get("endsAt");
  if (startsAt === null || endsAt === null)
    throw new HttpError(
      400,
      "invalid_service_availability_request",
      "Invalid availability preview request",
    );
  const value = await dependencies
    .createProtectedAdministration(
      createCloudflareAccessAssertionReader(request),
    )
    .getRegisteredServiceAvailabilityPreview.execute(serviceId, {
      startsAt,
      endsAt,
    });
  send(response, value);
}

function createAvailabilityHandler(
  dependencies: AdministrativeServiceAvailabilityRouteDependencies,
): RequestHandler {
  return (request, response, next) => {
    setAdministrativeSecurityHeaders(response);
    const releaseAdmission = dependencies.admission.tryAdmit();
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
    void processAvailability(request, response, dependencies)
      .catch((error) => next(mapAvailabilityError(error)))
      .finally(releaseAdmission);
  };
}

async function processAvailability(
  request: Request,
  response: Response,
  dependencies: AdministrativeServiceAvailabilityRouteDependencies,
): Promise<void> {
  const serviceId = request.params.serviceId;
  if (typeof serviceId !== "string" || !isServiceId(serviceId))
    throw new HttpError(
      404,
      "registered_service_not_found",
      "Service not found",
    );
  validateAdministrativeRequestTarget(request.url);
  rejectAdministrativeQuery(request.url);
  if (request.method === "GET") {
    const protectedAdministration = dependencies.createProtectedAdministration(
      createCloudflareAccessAssertionReader(request),
    );
    validateAdministrativeRequestHasNoBody(request);
    const value =
      await protectedAdministration.getRegisteredServiceAvailability.execute(
        serviceId,
      );
    send(
      response,
      mapAdministrativeAvailability(
        value as Parameters<typeof mapAdministrativeAvailability>[0],
      ),
    );
    return;
  }
  if (request.method !== "PUT" && request.method !== "DELETE") {
    response.setHeader("Allow", "GET, PUT, DELETE");
    throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
  }
  const releaseMutation = dependencies.mutationGate.tryAdmit();
  if (releaseMutation === undefined)
    throw new HttpError(
      409,
      "administrative_service_operation_busy",
      "Service operation is busy",
    );
  try {
    const body = await readBody(request);
    const protectedAdministration = dependencies.createProtectedAdministration(
      createCloudflareAccessAssertionReader(request),
    );
    if (request.method === "PUT") {
      const policy = parseMutationBody(body, "update");
      const value =
        await protectedAdministration.setRegisteredServiceAvailability.execute(
          serviceId,
          policy,
        );
      send(response, value);
    } else {
      parseMutationBody(body, "remove");
      const value =
        await protectedAdministration.removeRegisteredServiceAvailability.execute(
          serviceId,
        );
      send(response, { serviceId, removed: true, result: value });
    }
  } finally {
    releaseMutation();
  }
}

async function readBody(request: Request): Promise<unknown> {
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
    size += value.length;
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, "payload_too_large", "Payload too large");
    chunks.push(value);
  }
  if (!chunks.length)
    throw new HttpError(
      400,
      "invalid_service_availability_request",
      "Invalid availability request",
    );
  try {
    return parseStrictJson(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_service_availability_request",
      "Invalid availability request",
    );
  }
}

function parseMutationBody(input: unknown, kind: "update" | "remove"): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new HttpError(
      400,
      "invalid_service_availability_request",
      "Invalid availability request",
    );
  const record = input as Record<string, unknown>;
  const confirmation =
    kind === "update"
      ? "confirm_registered_service_availability_update"
      : "confirm_registered_service_availability_removal";
  if (kind === "update") {
    if (
      Reflect.ownKeys(record).length !== 2 ||
      record.confirmation !== confirmation ||
      !Object.hasOwn(record, "policy")
    )
      throw new HttpError(
        400,
        "invalid_service_availability_request",
        "Invalid availability request",
      );
    return record.policy;
  }
  if (
    Reflect.ownKeys(record).length !== 1 ||
    record.confirmation !== confirmation
  )
    throw new HttpError(
      400,
      "invalid_service_availability_request",
      "Invalid availability request",
    );
  return undefined;
}

function send(response: Response, value: unknown): void {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 65_536)
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

function mapAvailabilityError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const access = mapAdministrativeAccessControlError(error);
  if (access !== undefined) return access;
  if (error instanceof AdministrativeAccessControlError)
    return new HttpError(
      503,
      "administrative_service_management_unavailable",
      "Service availability unavailable",
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
  if (
    error instanceof Error &&
    Object.hasOwn(error, "code") &&
    (error as Error & { code?: unknown }).code === "invalid_interval"
  )
    return new HttpError(
      400,
      "invalid_service_availability_request",
      "Invalid availability preview request",
    );
  return new HttpError(
    503,
    "service_availability_unavailable",
    "Service availability unavailable",
  );
}
