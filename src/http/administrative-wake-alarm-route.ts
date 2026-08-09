import type { Express, Request, RequestHandler, Response } from "express";
import { isUtf8 } from "node:buffer";

import { parseStrictJson } from "../config/strict-json.js";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import { AdministrativeAccessControlError } from "../access-control/application/errors.js";
import {
  WakeAlarmScheduleValidationError,
  createWakeAlarmSchedule,
} from "../power-management/domain/wake-alarm-schedule.js";
import {
  AdministrativeAuditPartialEffectError,
  AdministrativeAuditTrailError,
} from "../event-history/application/administrative-audit-trail.js";
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
import {
  mapWakeAlarmMutationResponse,
  mapWakeAlarmObservationResponse,
  type WakeAlarmMutationHttpResponse,
  type WakeAlarmObservationHttpResponse,
} from "./administrative-wake-alarm-response.js";
import { HttpError } from "./errors/http-error.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_WAKE_ALARM_ROUTE = "/admin/power/wake-alarm";
export const ADMINISTRATIVE_WAKE_ALARM_MAX_BODY_BYTES = 512;
export const ADMINISTRATIVE_WAKE_ALARM_MAX_RESPONSE_BYTES = 16_384;

export interface ProtectedAdministrativeWakeAlarm {
  readonly getNextWakeAlarm: Readonly<{ execute(): Promise<unknown> }>;
  readonly scheduleWakeAlarm: Readonly<{
    execute(input: unknown): Promise<unknown>;
  }>;
  readonly cancelWakeAlarm: Readonly<{ execute(): Promise<unknown> }>;
}

export interface AdministrativeWakeAlarmRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly mutationGate: AdministrativePowerOperationGate;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeWakeAlarm;
}

export function registerAdministrativeWakeAlarmRoute(
  app: Express,
  dependencies: AdministrativeWakeAlarmRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    ["power.wake.read", "power.wake.update", "power.wake.delete"],
    createAdministrativeWakeAlarmHandler(dependencies),
  );
}

export function createAdministrativeWakeAlarmHandler(
  dependencies: AdministrativeWakeAlarmRouteDependencies,
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
  request: Request,
  response: Response,
  next: Parameters<RequestHandler>[2],
  dependencies: AdministrativeWakeAlarmRouteDependencies,
): Promise<void> {
  let releaseMutation: (() => void) | undefined;
  try {
    if (request.path !== ADMINISTRATIVE_WAKE_ALARM_ROUTE)
      throw new HttpError(404, "route_not_found", "Route not found");
    if (!["GET", "PUT", "DELETE"].includes(request.method)) {
      response.setHeader("Allow", "GET, PUT, DELETE");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }

    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);

    let schedule: unknown;
    if (request.method === "PUT") {
      schedule = await readScheduleBody(request);
      if (schedule === undefined)
        throw new HttpError(
          400,
          "invalid_wake_alarm_request",
          "Invalid wake-alarm request",
        );
      schedule = createWakeAlarmSchedule(schedule);
    } else validateAdministrativeRequestHasNoBody(request);

    if (request.method === "PUT" || request.method === "DELETE") {
      releaseMutation = dependencies.mutationGate.tryAdmit();
      if (releaseMutation === undefined)
        throw new HttpError(
          409,
          "administrative_wake_alarm_busy",
          "Wake-alarm mutation is busy",
        );
    }

    const reader = createCloudflareAccessAssertionReader(request);
    const protectedAdministration =
      dependencies.createProtectedAdministration(reader);
    if (request.method === "GET") {
      const observation =
        await protectedAdministration.getNextWakeAlarm.execute();
      sendBoundedResponse(
        response,
        mapWakeAlarmObservationResponse(observation),
      );
    } else if (request.method === "PUT") {
      const result =
        await protectedAdministration.scheduleWakeAlarm.execute(schedule);
      sendBoundedResponse(response, mapWakeAlarmMutationResponse(result));
    } else {
      const result = await protectedAdministration.cancelWakeAlarm.execute();
      sendBoundedResponse(response, mapWakeAlarmMutationResponse(result));
    }
  } catch (error) {
    next(mapWakeAlarmError(error));
  } finally {
    releaseMutation?.();
  }
}

async function readScheduleBody(request: Request): Promise<unknown> {
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
  const contentEncoding = request.headers["content-encoding"];
  if (
    contentEncoding !== undefined &&
    (Array.isArray(contentEncoding) || contentEncoding.length > 0)
  )
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Unsupported media type",
    );
  const contentLength = request.headers["content-length"];
  if (Array.isArray(contentLength))
    throw new HttpError(
      400,
      "invalid_wake_alarm_request",
      "Invalid wake-alarm request",
    );
  if (contentLength !== undefined) {
    if (!/^\d+$/u.test(contentLength))
      throw new HttpError(
        400,
        "invalid_wake_alarm_request",
        "Invalid wake-alarm request",
      );
    if (Number(contentLength) > ADMINISTRATIVE_WAKE_ALARM_MAX_BODY_BYTES)
      throw new HttpError(413, "payload_too_large", "Payload too large");
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    let buffer: Buffer;
    if (typeof chunk === "string") buffer = Buffer.from(chunk);
    else if (chunk instanceof Uint8Array) buffer = Buffer.from(chunk);
    else
      throw new HttpError(
        400,
        "invalid_wake_alarm_request",
        "Invalid wake-alarm request",
      );
    size += buffer.byteLength;
    if (size > ADMINISTRATIVE_WAKE_ALARM_MAX_BODY_BYTES)
      throw new HttpError(413, "payload_too_large", "Payload too large");
    chunks.push(new Uint8Array(buffer));
  }
  if (chunks.length === 0)
    throw new HttpError(
      400,
      "invalid_wake_alarm_request",
      "Invalid wake-alarm request",
    );
  const body = Buffer.concat(chunks);
  if (!isUtf8(new Uint8Array(body)))
    throw new HttpError(
      400,
      "invalid_wake_alarm_request",
      "Invalid wake-alarm request",
    );
  try {
    return parseStrictJson(body.toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_wake_alarm_request",
      "Invalid wake-alarm request",
    );
  }
}

function sendBoundedResponse(
  response: Response,
  body: WakeAlarmObservationHttpResponse | WakeAlarmMutationHttpResponse,
): void {
  const serialized = JSON.stringify(body);
  if (
    Buffer.byteLength(serialized, "utf8") >
    ADMINISTRATIVE_WAKE_ALARM_MAX_RESPONSE_BYTES
  )
    throw new HttpError(500, "internal_error", "Internal server error");
  response.status(200).type("application/json").send(serialized);
}

function mapWakeAlarmError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof WakeAlarmScheduleValidationError) {
    if (error.code === "scheduled_for_not_future")
      return new HttpError(
        422,
        "wake_alarm_schedule_not_future",
        "Wake-alarm schedule must be in the future",
      );
    return new HttpError(
      400,
      "invalid_wake_alarm_request",
      "Invalid wake-alarm request",
    );
  }
  if (error instanceof AdministrativeAuditPartialEffectError)
    return new HttpError(
      503,
      "administrative_wake_alarm_state_recheck_required",
      "Wake-alarm state recheck required",
    );
  if (error instanceof AdministrativeAuditTrailError)
    return new HttpError(
      503,
      "administrative_event_history_unavailable",
      "Administrative event history unavailable",
    );
  const accessError = mapAdministrativeAccessControlError(error);
  if (accessError !== undefined) {
    if (
      error instanceof AdministrativeAccessControlError &&
      error.code === "protected_operation_failed" &&
      (error.operation === "read_wake_alarm" ||
        error.operation === "schedule_wake_alarm" ||
        error.operation === "cancel_wake_alarm")
    )
      return new HttpError(
        503,
        "administrative_wake_alarm_unavailable",
        "Administrative wake alarm unavailable",
      );
    return accessError;
  }
  return new HttpError(500, "internal_error", "Internal server error");
}
