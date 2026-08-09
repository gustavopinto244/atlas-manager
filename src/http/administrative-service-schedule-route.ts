import type { Express, Request, RequestHandler, Response } from "express";

import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import { AdministrativeAccessControlError } from "../access-control/application/errors.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import type { AdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import { HttpError } from "./errors/http-error.js";
import { parseStrictJson } from "../config/strict-json.js";
import { RegisteredServiceNotFoundError } from "../service-management/application/registered-service-not-found-error.js";
import { ServiceAvailabilityPolicyValidationError } from "../service-scheduling/domain/service-availability-policy-validation-error.js";
import { ServiceScheduleValidationError } from "../service-scheduling/domain/service-schedule-validation-error.js";
import { ServiceScheduleTimezoneValidationError } from "../service-scheduling/domain/service-schedule-timezone.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_SERVICE_SCHEDULE_ROUTE =
  "/admin/services/:serviceId/schedule";
const MAX_BODY_BYTES = 4_096;

export interface ProtectedAdministrativeServiceSchedule {
  readonly getRegisteredServiceSchedule: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly setRegisteredServiceSchedule: Readonly<{
    execute(serviceId: string, input: unknown): Promise<unknown>;
  }>;
  readonly removeRegisteredServiceSchedule: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
}

export interface AdministrativeServiceScheduleRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly mutationGate: AdministrativePowerOperationGate;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeServiceSchedule;
}

export function registerAdministrativeServiceScheduleRoutes(
  app: Express,
  dependencies: AdministrativeServiceScheduleRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    [
      "services.schedule.read",
      "services.schedule.update",
      "services.schedule.delete",
    ],
    createHandler(dependencies),
  );
}

function createHandler(
  dependencies: AdministrativeServiceScheduleRouteDependencies,
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
    void process(request, response, dependencies)
      .catch((error) => next(mapError(error)))
      .finally(releaseAdmission);
  };
}

async function process(
  request: Request,
  response: Response,
  dependencies: AdministrativeServiceScheduleRouteDependencies,
): Promise<void> {
  if (
    request.method !== "GET" &&
    request.method !== "PUT" &&
    request.method !== "DELETE"
  ) {
    response.setHeader("Allow", "GET, PUT, DELETE");
    throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
  }
  const serviceId = request.params.serviceId;
  if (
    typeof serviceId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(serviceId)
  )
    throw new HttpError(
      404,
      "registered_service_not_found",
      "Service not found",
    );
  validateAdministrativeRequestTarget(request.url);
  rejectAdministrativeQuery(request.url);
  const protectedAdministration = dependencies.createProtectedAdministration(
    createCloudflareAccessAssertionReader(request),
  );
  if (request.method === "GET") {
    validateAdministrativeRequestHasNoBody(request);
    send(
      response,
      await protectedAdministration.getRegisteredServiceSchedule.execute(
        serviceId,
      ),
    );
    return;
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
    if (request.method === "PUT") {
      const policy = parseMutation(body, "update");
      send(
        response,
        await protectedAdministration.setRegisteredServiceSchedule.execute(
          serviceId,
          policy,
        ),
      );
    } else {
      parseMutation(body, "remove");
      await protectedAdministration.removeRegisteredServiceSchedule.execute(
        serviceId,
      );
      send(response, { serviceId, removed: true });
    }
  } finally {
    releaseMutation();
  }
}

async function readBody(request: Request): Promise<unknown> {
  if (
    request.headers["content-type"] !== "application/json" &&
    request.headers["content-type"] !== "application/json; charset=utf-8"
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
      "invalid_service_schedule_request",
      "Invalid service schedule request",
    );
  try {
    return parseStrictJson(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_service_schedule_request",
      "Invalid service schedule request",
    );
  }
}

function parseMutation(input: unknown, kind: "update" | "remove"): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new HttpError(
      400,
      "invalid_service_schedule_request",
      "Invalid service schedule request",
    );
  const record = input as Record<string, unknown>;
  const confirmation =
    kind === "update"
      ? "confirm_registered_service_schedule_update"
      : "confirm_registered_service_schedule_removal";
  const expectedFields =
    kind === "update" ? ["confirmation", "policy"] : ["confirmation"];
  if (
    Reflect.ownKeys(record).length !== expectedFields.length ||
    expectedFields.some((field) => !Object.hasOwn(record, field)) ||
    record.confirmation !== confirmation
  )
    throw new HttpError(
      400,
      "invalid_service_schedule_request",
      "Invalid service schedule request",
    );
  return kind === "update" ? record.policy : undefined;
}

function send(response: Response, value: unknown): void {
  response.status(200).type("application/json").send(JSON.stringify(value));
}

function mapError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof AdministrativeAccessControlError) {
    return (
      mapAdministrativeAccessControlError(error) ??
      new HttpError(
        403,
        "administrative_access_denied",
        "Administrative access denied",
      )
    );
  }
  if (error instanceof RegisteredServiceNotFoundError)
    return new HttpError(
      404,
      "registered_service_not_found",
      "Service not found",
    );
  if (
    error instanceof ServiceAvailabilityPolicyValidationError ||
    error instanceof ServiceScheduleValidationError ||
    error instanceof ServiceScheduleTimezoneValidationError
  )
    return new HttpError(
      400,
      "invalid_service_schedule_request",
      "Invalid service schedule request",
    );
  return new HttpError(500, "internal_error", "Internal server error");
}
