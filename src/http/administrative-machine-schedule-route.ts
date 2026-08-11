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
import { MachineOperatingPolicyValidationError } from "../power-management/domain/machine-operating-policy.js";
import { MachineWeeklyOperatingScheduleValidationError } from "../power-management/domain/machine-weekly-operating-schedule.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_MACHINE_SCHEDULE_ROUTE = "/admin/machine/schedule";
const MAX_BODY_BYTES = 4_096;

export interface ProtectedAdministrativeMachineSchedule {
  readonly getMachineOperatingPolicy: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly setMachineOperatingPolicy: Readonly<{
    execute(input: unknown): Promise<unknown>;
  }>;
  readonly removeMachineOperatingPolicy: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly previewMachineOperatingPolicy: Readonly<{
    execute(candidatePolicy: unknown): Promise<unknown>;
  }>;
}

export interface AdministrativeMachineScheduleRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly mutationGate: AdministrativePowerOperationGate;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeMachineSchedule;
}

export function registerAdministrativeMachineScheduleRoutes(
  app: Express,
  dependencies: AdministrativeMachineScheduleRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    [
      "machine.schedule.read",
      "machine.schedule.update",
      "machine.schedule.delete",
    ],
    createHandler(dependencies),
  );
  registerAdministrativeRoute(
    app,
    ["machine.schedule.preview"],
    createPreviewHandler(dependencies),
  );
}

function createPreviewHandler(
  dependencies: AdministrativeMachineScheduleRouteDependencies,
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
    void processPreview(request, response, dependencies)
      .catch((error) => next(mapError(error)))
      .finally(releaseAdmission);
  };
}

async function processPreview(
  request: Request,
  response: Response,
  dependencies: AdministrativeMachineScheduleRouteDependencies,
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
  }
  validateAdministrativeRequestTarget(request.url);
  validateAdministrativeRequestHasNoBody(request);
  const query = new URL(request.url, "http://atlas.invalid").searchParams;
  const keys = [...query.keys()];
  if (keys.length !== 1 || new Set(keys).size !== 1 || !keys.includes("policy"))
    throw new HttpError(
      400,
      "invalid_machine_schedule_request",
      "Invalid machine schedule request",
    );
  const rawPolicy = query.get("policy");
  if (rawPolicy === null)
    throw new HttpError(
      400,
      "invalid_machine_schedule_request",
      "Invalid machine schedule request",
    );
  if (Buffer.byteLength(rawPolicy, "utf8") > MAX_BODY_BYTES)
    throw new HttpError(413, "payload_too_large", "Payload too large");
  let policy: unknown;
  try {
    policy = parseStrictJson(rawPolicy);
  } catch {
    throw new HttpError(
      400,
      "invalid_machine_schedule_request",
      "Invalid machine schedule request",
    );
  }
  const protectedAdministration = dependencies.createProtectedAdministration(
    createCloudflareAccessAssertionReader(request),
  );
  send(
    response,
    await protectedAdministration.previewMachineOperatingPolicy.execute(policy),
  );
}

function createHandler(
  dependencies: AdministrativeMachineScheduleRouteDependencies,
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
  dependencies: AdministrativeMachineScheduleRouteDependencies,
): Promise<void> {
  if (
    request.method !== "GET" &&
    request.method !== "PUT" &&
    request.method !== "DELETE"
  ) {
    response.setHeader("Allow", "GET, PUT, DELETE");
    throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
  }
  validateAdministrativeRequestTarget(request.url);
  rejectAdministrativeQuery(request.url);
  const protectedAdministration = dependencies.createProtectedAdministration(
    createCloudflareAccessAssertionReader(request),
  );
  if (request.method === "GET") {
    validateAdministrativeRequestHasNoBody(request);
    send(
      response,
      await protectedAdministration.getMachineOperatingPolicy.execute(),
    );
    return;
  }
  const releaseMutation = dependencies.mutationGate.tryAdmit();
  if (releaseMutation === undefined)
    throw new HttpError(
      409,
      "administrative_machine_schedule_operation_busy",
      "Machine schedule operation is busy",
    );
  try {
    const body = await readBody(request);
    if (request.method === "PUT") {
      const policy = parseMutation(body, "update");
      send(
        response,
        await protectedAdministration.setMachineOperatingPolicy.execute(policy),
      );
    } else {
      parseMutation(body, "remove");
      await protectedAdministration.removeMachineOperatingPolicy.execute();
      send(response, { removed: true });
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
      "invalid_machine_schedule_request",
      "Invalid machine schedule request",
    );
  try {
    return parseStrictJson(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_machine_schedule_request",
      "Invalid machine schedule request",
    );
  }
}

function parseMutation(input: unknown, kind: "update" | "remove"): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new HttpError(
      400,
      "invalid_machine_schedule_request",
      "Invalid machine schedule request",
    );
  const record = input as Record<string, unknown>;
  const confirmation =
    kind === "update"
      ? "confirm_machine_operating_policy_update"
      : "confirm_machine_operating_policy_removal";
  const expectedFields =
    kind === "update" ? ["confirmation", "policy"] : ["confirmation"];
  if (
    Reflect.ownKeys(record).length !== expectedFields.length ||
    expectedFields.some((field) => !Object.hasOwn(record, field)) ||
    record.confirmation !== confirmation
  )
    throw new HttpError(
      400,
      "invalid_machine_schedule_request",
      "Invalid machine schedule request",
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
  if (
    error instanceof MachineOperatingPolicyValidationError ||
    error instanceof MachineWeeklyOperatingScheduleValidationError
  )
    return new HttpError(
      400,
      "invalid_machine_schedule_request",
      "Invalid machine schedule request",
    );
  return new HttpError(500, "internal_error", "Internal server error");
}
