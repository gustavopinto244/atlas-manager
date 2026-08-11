import { isUtf8 } from "node:buffer";
import type { Express, Request, RequestHandler, Response } from "express";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import type { AdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import { parseStrictJson } from "../config/strict-json.js";
import { HttpError } from "./errors/http-error.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import {
  mapEventHistoryExport,
  mapEventHistoryIntegrity,
  mapEventHistoryPolicy,
  mapEventHistoryRetention,
} from "./administrative-event-history-operations-response.js";
import type {
  EventHistoryExportResult,
  EventHistoryIntegrityResult,
  EventHistoryRetentionSummary,
} from "../event-history/application/ports/administrative-event-history-operations.js";
import { SegmentedEventHistoryError } from "../event-history/infrastructure/file-segmented-administrative-event-history.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_PREFIX =
  "/admin/event-history";
const MAX_BODY_BYTES = 8 * 1024;

export interface ProtectedAdministrativeEventHistoryOperations {
  readonly verifyEventHistoryIntegrity: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly rotateEventHistory: Readonly<{ execute(): Promise<unknown> }>;
  readonly getEventHistoryRetention: Readonly<{ execute(): Promise<unknown> }>;
  readonly setEventHistoryRetention: Readonly<{
    execute(value: unknown): Promise<unknown>;
  }>;
  readonly pruneEventHistory: Readonly<{ execute(): Promise<unknown> }>;
  readonly listEventHistoryExports: Readonly<{ execute(): Promise<unknown> }>;
  readonly getEventHistoryExport: Readonly<{
    execute(exportId: string): Promise<unknown>;
  }>;
  readonly createEventHistoryExport: Readonly<{
    execute(value: unknown): Promise<unknown>;
  }>;
  readonly downloadEventHistoryExport: Readonly<{
    execute(exportId: string): Promise<unknown>;
  }>;
  readonly pruneEventHistoryExports: Readonly<{ execute(): Promise<unknown> }>;
}

export interface AdministrativeEventHistoryOperationsRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly mutationGate: AdministrativePowerOperationGate;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeEventHistoryOperations;
}

export function registerAdministrativeEventHistoryOperationsRoutes(
  app: Express,
  dependencies: AdministrativeEventHistoryOperationsRouteDependencies,
): void {
  const routes: readonly [string, RouteKind, string][] = [
    [
      "event_history.integrity.read",
      "integrity",
      "/admin/event-history/integrity",
    ],
    [
      "event_history.rotation.run",
      "rotation",
      "/admin/event-history/rotations",
    ],
    [
      "event_history.retention.read",
      "retention",
      "/admin/event-history/retention",
    ],
    [
      "event_history.retention.update",
      "retention",
      "/admin/event-history/retention",
    ],
    [
      "event_history.retention.prune",
      "segmentPrune",
      "/admin/event-history/retention/prunes",
    ],
    [
      "event_history.exports.prune",
      "exportPrune",
      "/admin/event-history/exports/retention/prunes",
    ],
    ["event_history.exports.read", "exports", "/admin/event-history/exports"],
    ["event_history.exports.create", "exports", "/admin/event-history/exports"],
    [
      "event_history.export.download",
      "download",
      "/admin/event-history/exports/:exportId/content",
    ],
    [
      "event_history.export.read",
      "export",
      "/admin/event-history/exports/:exportId",
    ],
  ];
  const grouped = new Map<string, { ids: string[]; kind: RouteKind }>();
  for (const [routeId, kind, path] of routes) {
    const existing = grouped.get(path);
    if (existing === undefined) grouped.set(path, { ids: [routeId], kind });
    else existing.ids.push(routeId);
  }
  for (const value of grouped.values())
    registerAdministrativeRoute(
      app,
      value.ids,
      handler(dependencies, value.kind),
    );
}

type RouteKind =
  | "integrity"
  | "rotation"
  | "retention"
  | "segmentPrune"
  | "exports"
  | "export"
  | "download"
  | "exportPrune";

function handler(
  dependencies: AdministrativeEventHistoryOperationsRouteDependencies,
  kind: RouteKind,
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
    void process(request, response, dependencies, kind)
      .catch((error) => next(mapError(error)))
      .finally(release);
  };
}

async function process(
  request: Request,
  response: Response,
  dependencies: AdministrativeEventHistoryOperationsRouteDependencies,
  kind: RouteKind,
): Promise<void> {
  validateAdministrativeRequestTarget(request.url);
  const protectedAdministration = () =>
    dependencies.createProtectedAdministration(
      createCloudflareAccessAssertionReader(request),
    );
  if (kind === "integrity") {
    requireMethod(request, "GET");
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    send(
      response,
      mapEventHistoryIntegrity(
        (await protectedAdministration().verifyEventHistoryIntegrity.execute()) as EventHistoryIntegrityResult,
      ),
    );
    return;
  }
  if (kind === "rotation") {
    requireMethod(request, "POST");
    rejectAdministrativeQuery(request.url);
    const body = await bodyJson(request);
    exactConfirmation(body, "confirm_administrative_event_history_rotation");
    send(
      response,
      await mutate(dependencies, () =>
        protectedAdministration().rotateEventHistory.execute(),
      ),
    );
    return;
  }
  if (kind === "retention") {
    rejectAdministrativeQuery(request.url);
    if (request.method === "GET") {
      validateAdministrativeRequestHasNoBody(request);
      send(
        response,
        mapEventHistoryRetention(
          (await protectedAdministration().getEventHistoryRetention.execute()) as EventHistoryRetentionSummary,
        ),
      );
      return;
    }
    requireMethod(request, "GET", "PUT");
    const body = await bodyJson(request);
    const policy = exactPolicy(
      body,
      "confirm_administrative_event_history_retention_update",
    );
    send(
      response,
      mapEventHistoryPolicy(
        (await mutate(dependencies, () =>
          protectedAdministration().setEventHistoryRetention.execute(policy),
        )) as never,
      ),
    );
    return;
  }
  if (kind === "segmentPrune") {
    requireMethod(request, "POST");
    rejectAdministrativeQuery(request.url);
    exactConfirmation(
      await bodyJson(request),
      "confirm_administrative_event_history_retention_prune",
    );
    send(
      response,
      await mutate(dependencies, () =>
        protectedAdministration().pruneEventHistory.execute(),
      ),
    );
    return;
  }
  if (kind === "exportPrune") {
    requireMethod(request, "POST");
    rejectAdministrativeQuery(request.url);
    exactConfirmation(
      await bodyJson(request),
      "confirm_administrative_event_history_export_prune",
    );
    send(
      response,
      await mutate(dependencies, () =>
        protectedAdministration().pruneEventHistoryExports.execute(),
      ),
    );
    return;
  }
  if (kind === "exports") {
    if (request.method === "GET") {
      rejectAdministrativeQuery(request.url);
      validateAdministrativeRequestHasNoBody(request);
      const exports =
        (await protectedAdministration().listEventHistoryExports.execute()) as readonly unknown[];
      send(response, {
        exports: exports.map((value) => mapEventHistoryExport(value as never)),
      });
      return;
    }
    requireMethod(request, "POST");
    rejectAdministrativeQuery(request.url);
    const body = await bodyJson(request);
    const range = exactExportBody(body);
    const result = (await mutate(dependencies, () =>
      protectedAdministration().createEventHistoryExport.execute(range),
    )) as EventHistoryExportResult;
    send(response, mapEventHistoryExport(result.metadata));
    return;
  }
  const exportIdValue = request.params.exportId;
  const exportId = typeof exportIdValue === "string" ? exportIdValue : "";
  if (!/^[0-9a-f]{64}$/u.test(exportId ?? ""))
    throw new HttpError(
      404,
      "event_history_export_not_found",
      "Export not found",
    );
  if (kind === "export") {
    requireMethod(request, "GET");
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    send(
      response,
      mapEventHistoryExport(
        (await protectedAdministration().getEventHistoryExport.execute(
          exportId,
        )) as never,
      ),
    );
    return;
  }
  requireMethod(request, "GET");
  rejectAdministrativeQuery(request.url);
  validateAdministrativeRequestHasNoBody(request);
  const content =
    await protectedAdministration().downloadEventHistoryExport.execute(
      exportId,
    );
  if (!Buffer.isBuffer(content))
    throw new HttpError(500, "internal_error", "Internal server error");
  response
    .status(200)
    .type("application/x-ndjson")
    .setHeader(
      "Content-Disposition",
      `attachment; filename="atlas-manager-event-history-${exportId}.jsonl"`,
    )
    .setHeader("Cache-Control", "no-store, private")
    .setHeader("Accept-Ranges", "none")
    .send(content);
}

async function mutate(
  dependencies: AdministrativeEventHistoryOperationsRouteDependencies,
  operation: () => Promise<unknown>,
): Promise<unknown> {
  const release = dependencies.mutationGate.tryAdmit();
  if (release === undefined)
    throw new HttpError(
      409,
      "event_history_retention_busy",
      "Event-history maintenance is busy",
    );
  try {
    return await operation();
  } finally {
    release();
  }
}

async function bodyJson(request: Request): Promise<unknown> {
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
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, "payload_too_large", "Payload too large");
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  if (!isUtf8(bytes))
    throw new HttpError(
      400,
      "invalid_event_history_request",
      "Invalid event-history request",
    );
  try {
    return parseStrictJson(bytes.toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_event_history_request",
      "Invalid event-history request",
    );
  }
}

function exactConfirmation(value: unknown, expected: string): void {
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).length !== 1 ||
    value.confirmation !== expected
  )
    throw new HttpError(
      400,
      "invalid_event_history_request",
      "Invalid event-history request",
    );
}
function exactPolicy(value: unknown, expected: string): unknown {
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).length !== 2 ||
    value.confirmation !== expected ||
    !Object.hasOwn(value, "policy")
  )
    throw new HttpError(
      400,
      "invalid_event_history_request",
      "Invalid event-history request",
    );
  return value.policy;
}
function exactExportBody(
  value: unknown,
): Readonly<{ fromSequence: number; throughSequence: number }> {
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).length !== 3 ||
    value.confirmation !== "confirm_administrative_event_history_export" ||
    !Number.isSafeInteger(value.fromSequence) ||
    !Number.isSafeInteger(value.throughSequence)
  )
    throw new HttpError(
      400,
      "invalid_event_history_request",
      "Invalid event-history request",
    );
  return Object.freeze({
    fromSequence: value.fromSequence as number,
    throughSequence: value.throughSequence as number,
  });
}
function requireMethod(request: Request, ...methods: string[]): void {
  if (!methods.includes(request.method)) {
    request.res?.setHeader("Allow", methods.join(", "));
    throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
  }
}
function send(response: Response, body: unknown): void {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > 1_048_576)
    throw new HttpError(500, "internal_error", "Internal server error");
  response.status(200).type("application/json").send(serialized);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mapError(error: unknown): HttpError {
  const access = mapAdministrativeAccessControlError(error);
  if (access !== undefined) return access;
  if (error instanceof HttpError) return error;
  if (error instanceof SegmentedEventHistoryError) {
    const status =
      error.code === "event_history_export_not_found"
        ? 404
        : error.code === "event_history_writer_busy"
          ? 409
          : error.code === "event_history_history_pruned"
            ? 410
            : 503;
    const code =
      error.code === "event_history_history_pruned"
        ? "event_history_pruned"
        : error.code === "event_history_export_not_found"
          ? "event_history_export_not_found"
          : error.code === "event_history_writer_busy"
            ? "event_history_writer_busy"
            : error.code === "event_history_interrupted"
              ? "event_history_interrupted"
              : error.code === "event_history_corrupted"
                ? "event_history_integrity_broken"
                : "event_history_integrity_unavailable";
    return new HttpError(status, code, "Event history operation unavailable");
  }
  if (
    error instanceof Error &&
    error.message === "event_history_history_pruned"
  )
    return new HttpError(
      410,
      "event_history_pruned",
      "Event history was pruned",
    );
  if (
    error instanceof Error &&
    error.message === "event_history_export_not_found"
  )
    return new HttpError(
      404,
      "event_history_export_not_found",
      "Export not found",
    );
  if (
    error instanceof Error &&
    error.message === "event_history_retention_invalid"
  )
    return new HttpError(
      400,
      "invalid_event_history_request",
      "Invalid event-history request",
    );
  return new HttpError(
    503,
    "event_history_integrity_unavailable",
    "Event history unavailable",
  );
}
