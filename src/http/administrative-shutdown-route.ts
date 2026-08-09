import type { Express, Request, RequestHandler, Response } from "express";
import { isUtf8 } from "node:buffer";

import { parseStrictJson } from "../config/strict-json.js";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import { AdministrativeAccessControlError } from "../access-control/application/errors.js";
import { MachineShutdownOccurrenceExecutionError } from "../power-management/application/execute-machine-shutdown-occurrence.js";
import {
  MachineShutdownConfirmationValidationError,
  createMachineShutdownConfirmation,
} from "../power-management/domain/machine-shutdown-confirmation.js";
import {
  MachineShutdownOccurrenceValidationError,
  createMachineShutdownOccurrence,
} from "../power-management/domain/machine-shutdown-occurrence.js";
import {
  AdministrativeAuditPartialEffectError,
  AdministrativeAuditTrailError,
} from "../event-history/application/administrative-audit-trail.js";
import type { MachineShutdownConfirmationReader } from "../power-management/application/ports/machine-shutdown-readiness-readers.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import type { AdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import { HttpError } from "./errors/http-error.js";
import {
  mapMachineShutdownExecutionResponse,
  mapMachineShutdownPreparationResponse,
} from "./administrative-shutdown-response.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE =
  "/admin/power/shutdown/preparations";
export const ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE =
  "/admin/power/shutdown/executions";
export const ADMINISTRATIVE_SHUTDOWN_MAX_BODY_BYTES = 1_024;
export const ADMINISTRATIVE_SHUTDOWN_MAX_RESPONSE_BYTES = 65_536;
const MAX_OFFLINE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ProtectedAdministrativeShutdown {
  readonly prepareMachineShutdownOccurrence: Readonly<{
    execute(input: unknown): Promise<unknown>;
  }>;
  readonly executeMachineShutdownOccurrence: Readonly<{
    execute(input: unknown): Promise<unknown>;
  }>;
}

export interface AdministrativeShutdownRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly powerOperationGate: AdministrativePowerOperationGate;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
    confirmationReader: MachineShutdownConfirmationReader,
  ) => ProtectedAdministrativeShutdown;
}

export function registerAdministrativeShutdownRoutes(
  app: Express,
  dependencies: AdministrativeShutdownRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    ["power.shutdown.prepare"],
    createAdministrativeShutdownHandler("preparation", dependencies),
  );
  registerAdministrativeRoute(
    app,
    ["power.shutdown.execute"],
    createAdministrativeShutdownHandler("execution", dependencies),
  );
}

function createAdministrativeShutdownHandler(
  stage: "preparation" | "execution",
  dependencies: AdministrativeShutdownRouteDependencies,
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
    void processShutdownRequest(
      stage,
      request,
      response,
      next,
      dependencies,
    ).finally(releaseAdmission);
  };
}

async function processShutdownRequest(
  stage: "preparation" | "execution",
  request: Request,
  response: Response,
  next: Parameters<RequestHandler>[2],
  dependencies: AdministrativeShutdownRouteDependencies,
): Promise<void> {
  let releasePower: (() => void) | undefined;
  try {
    const expectedRoute =
      stage === "preparation"
        ? ADMINISTRATIVE_SHUTDOWN_PREPARATION_ROUTE
        : ADMINISTRATIVE_SHUTDOWN_EXECUTION_ROUTE;
    if (request.path !== expectedRoute)
      throw new HttpError(404, "route_not_found", "Route not found");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);
    const body = await readShutdownBody(request);
    const parsed = parseShutdownRequest(body, stage);
    const occurrence = parsed.occurrence;
    releasePower = dependencies.powerOperationGate.tryAdmit();
    if (releasePower === undefined)
      throw new HttpError(
        409,
        "administrative_power_operation_busy",
        "Administrative power operation is busy",
      );
    const confirmationReader = createRequestConfirmationReader(
      parsed.confirmation,
    );
    const reader = createCloudflareAccessAssertionReader(request);
    const protectedAdministration = dependencies.createProtectedAdministration(
      reader,
      confirmationReader,
    );
    const result =
      stage === "preparation"
        ? await protectedAdministration.prepareMachineShutdownOccurrence.execute(
            occurrence,
          )
        : await protectedAdministration.executeMachineShutdownOccurrence.execute(
            occurrence,
          );
    sendBoundedResponse(
      response,
      stage === "preparation"
        ? mapMachineShutdownPreparationResponse(result)
        : mapMachineShutdownExecutionResponse(result),
    );
  } catch (error) {
    next(mapShutdownError(error, stage));
  } finally {
    releasePower?.();
  }
}

async function readShutdownBody(request: Request): Promise<unknown> {
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
  if (
    Array.isArray(contentLength) ||
    (contentLength !== undefined && !/^\d+$/u.test(contentLength))
  )
    throw new HttpError(
      400,
      "invalid_machine_shutdown_request",
      "Invalid machine-shutdown request",
    );
  if (
    contentLength !== undefined &&
    Number(contentLength) > ADMINISTRATIVE_SHUTDOWN_MAX_BODY_BYTES
  )
    throw new HttpError(413, "payload_too_large", "Payload too large");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : undefined;
    if (buffer === undefined)
      throw new HttpError(
        400,
        "invalid_machine_shutdown_request",
        "Invalid machine-shutdown request",
      );
    size += buffer.byteLength;
    if (size > ADMINISTRATIVE_SHUTDOWN_MAX_BODY_BYTES)
      throw new HttpError(413, "payload_too_large", "Payload too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0)
    throw new HttpError(
      400,
      "invalid_machine_shutdown_request",
      "Invalid machine-shutdown request",
    );
  const bytes = Buffer.concat(chunks);
  if (!isUtf8(bytes))
    throw new HttpError(
      400,
      "invalid_machine_shutdown_request",
      "Invalid machine-shutdown request",
    );
  try {
    return parseStrictJson(bytes.toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_machine_shutdown_request",
      "Invalid machine-shutdown request",
    );
  }
}

function parseShutdownRequest(
  body: unknown,
  stage: "preparation" | "execution",
) {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new HttpError(
      400,
      "invalid_machine_shutdown_request",
      "Invalid machine-shutdown request",
    );
  const record = body as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).length !== 4 ||
    !["operation", "scheduledFor", "wakeScheduledFor", "confirmation"].every(
      (key) => Object.hasOwn(record, key),
    )
  )
    throw new HttpError(
      400,
      "invalid_machine_shutdown_request",
      "Invalid machine-shutdown request",
    );
  try {
    const occurrence = createMachineShutdownOccurrence({
      operation: record.operation,
      scheduledFor: record.scheduledFor,
      wakeScheduledFor: record.wakeScheduledFor,
    });
    const confirmation = createMachineShutdownConfirmation(record.confirmation);
    if (confirmation.stage !== stage)
      throw new MachineShutdownConfirmationValidationError();
    if (
      Date.parse(occurrence.wakeScheduledFor) -
        Date.parse(occurrence.scheduledFor) >
      MAX_OFFLINE_INTERVAL_MS
    )
      throw new HttpError(
        422,
        "invalid_machine_shutdown_interval",
        "Invalid machine-shutdown interval",
      );
    return { occurrence, confirmation };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "invalid_machine_shutdown_request",
      "Invalid machine-shutdown request",
    );
  }
}

function createRequestConfirmationReader(
  confirmation: ReturnType<typeof createMachineShutdownConfirmation>,
): MachineShutdownConfirmationReader {
  return Object.freeze({
    read: () => {
      void confirmation;
      return Promise.resolve("confirmed" as const);
    },
  });
}

function sendBoundedResponse(
  response: Response,
  body: Record<string, unknown>,
): void {
  const serialized = JSON.stringify(body);
  if (
    Buffer.byteLength(serialized, "utf8") >
    ADMINISTRATIVE_SHUTDOWN_MAX_RESPONSE_BYTES
  )
    throw new HttpError(500, "internal_error", "Internal server error");
  response.status(200).type("application/json").send(serialized);
}

function mapShutdownError(
  error: unknown,
  stage: "preparation" | "execution",
): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof MachineShutdownOccurrenceValidationError)
    return new HttpError(
      400,
      "invalid_machine_shutdown_request",
      "Invalid machine-shutdown request",
    );
  if (error instanceof AdministrativeAuditPartialEffectError)
    return new HttpError(
      503,
      error.code === "audit_failed_after_shutdown_preparation"
        ? "administrative_shutdown_preparation_state_recheck_required"
        : "administrative_shutdown_state_recheck_required",
      "Administrative shutdown state recheck required",
    );
  if (error instanceof AdministrativeAuditTrailError)
    return new HttpError(
      503,
      "administrative_event_history_unavailable",
      "Administrative event history unavailable",
    );
  if (error instanceof MachineShutdownOccurrenceExecutionError)
    return new HttpError(
      503,
      error.code === "claim_failed"
        ? "administrative_shutdown_claim_unavailable"
        : "administrative_shutdown_state_recheck_required",
      "Administrative shutdown state requires inspection",
    );
  const accessError = mapAdministrativeAccessControlError(error);
  if (accessError !== undefined) {
    if (
      error instanceof AdministrativeAccessControlError &&
      error.code === "protected_operation_failed"
    )
      return new HttpError(
        503,
        stage === "preparation"
          ? "administrative_shutdown_preparation_unavailable"
          : "administrative_shutdown_readiness_unavailable",
        "Administrative shutdown operation unavailable",
      );
    return accessError;
  }
  return new HttpError(500, "internal_error", "Internal server error");
}
