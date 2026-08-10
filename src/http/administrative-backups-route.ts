import { isUtf8 } from "node:buffer";
import type { Express, Request, RequestHandler, Response } from "express";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import type { BackupRunQuery } from "../backup-management/application/ports/backup-ports.js";
import { parseStrictJson } from "../config/strict-json.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import type { AdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import { HttpError } from "./errors/http-error.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import {
  mapBackupRun,
  mapBackupTarget,
} from "./administrative-backup-response.js";
import { BackupTargetValidationError } from "../backup-management/domain/backup-target.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_BACKUPS_PREFIX = "/admin/backups";
const MAX_BODY_BYTES = 4_096;

export interface ProtectedAdministrativeBackups {
  readonly getRegisteredBackupTargets: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly getRegisteredBackupTarget: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly getBackupRuns: Readonly<{
    execute(query?: unknown): Promise<unknown>;
  }>;
  readonly getBackupRun: Readonly<{ execute(runId: string): Promise<unknown> }>;
  readonly runRegisteredBackup: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly getBackupSchedule: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly setBackupSchedule: Readonly<{
    execute(targetId: string, value: unknown): Promise<unknown>;
  }>;
  readonly removeBackupSchedule: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly getBackupRetention: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly setBackupRetention: Readonly<{
    execute(targetId: string, value: unknown): Promise<unknown>;
  }>;
  readonly pruneBackupRetention: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly runBackupSchedulerTick: Readonly<{ execute(): Promise<unknown> }>;
}

export interface AdministrativeBackupsRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly mutationGate: AdministrativePowerOperationGate;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeBackups;
}

export function registerAdministrativeBackupRoutes(
  app: Express,
  dependencies: AdministrativeBackupsRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    ["backups.targets.read"],
    handler(dependencies, "targets"),
  );
  registerAdministrativeRoute(
    app,
    ["backups.target.read"],
    handler(dependencies, "target"),
  );
  registerAdministrativeRoute(
    app,
    ["backups.runs.read"],
    handler(dependencies, "runs"),
  );
  registerAdministrativeRoute(
    app,
    ["backups.run.read"],
    handler(dependencies, "run"),
  );
  registerAdministrativeRoute(
    app,
    ["backups.run"],
    handler(dependencies, "manual"),
  );
  registerAdministrativeRoute(
    app,
    [
      "backups.schedule.read",
      "backups.schedule.update",
      "backups.schedule.delete",
    ],
    handler(dependencies, "schedule"),
  );
  registerAdministrativeRoute(
    app,
    ["backups.retention.read", "backups.retention.update"],
    handler(dependencies, "retention"),
  );
  registerAdministrativeRoute(
    app,
    ["backups.retention.prune"],
    handler(dependencies, "prune"),
  );
  registerAdministrativeRoute(
    app,
    ["backups.scheduler.tick"],
    handler(dependencies, "tick"),
  );
}

type RouteKind =
  | "targets"
  | "target"
  | "runs"
  | "run"
  | "manual"
  | "schedule"
  | "retention"
  | "prune"
  | "tick";

function handler(
  dependencies: AdministrativeBackupsRouteDependencies,
  kind: RouteKind,
): RequestHandler {
  return (request, response, next) => {
    setAdministrativeSecurityHeaders(response);
    const admission = dependencies.admission.tryAdmit();
    if (admission === undefined) {
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
      .finally(admission);
  };
}

async function process(
  request: Request,
  response: Response,
  dependencies: AdministrativeBackupsRouteDependencies,
  kind: RouteKind,
): Promise<void> {
  validateAdministrativeRequestTarget(request.url);
  const protectedAdministration = () =>
    dependencies.createProtectedAdministration(
      createCloudflareAccessAssertionReader(request),
    );
  const targetId = paramString(request.params.targetId);
  if (
    (kind === "target" ||
      kind === "manual" ||
      kind === "schedule" ||
      kind === "retention" ||
      kind === "prune") &&
    !isTargetId(targetId)
  )
    throw new HttpError(
      404,
      "registered_backup_target_not_found",
      "Backup target not found",
    );
  if (kind === "targets") {
    requireMethod(request, "GET");
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    const value =
      await protectedAdministration().getRegisteredBackupTargets.execute();
    send(response, {
      targets: (value as readonly unknown[]).map((target) =>
        mapBackupTarget(target as never),
      ),
    });
    return;
  }
  if (kind === "target") {
    requireMethod(request, "GET");
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    send(
      response,
      mapBackupTarget(
        (await protectedAdministration().getRegisteredBackupTarget.execute(
          targetId!,
        )) as never,
      ),
    );
    return;
  }
  if (kind === "runs") {
    requireMethod(request, "GET");
    const query = parseRunQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    const value = await protectedAdministration().getBackupRuns.execute(query);
    send(response, {
      runs: (value as readonly unknown[]).map((run) =>
        mapBackupRun(run as never),
      ),
    });
    return;
  }
  if (kind === "run") {
    requireMethod(request, "GET");
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    const runId = paramString(request.params.runId);
    if (!isRunId(runId))
      throw new HttpError(404, "backup_run_not_found", "Backup run not found");
    send(
      response,
      mapBackupRun(
        (await protectedAdministration().getBackupRun.execute(runId)) as never,
      ),
    );
    return;
  }
  if (kind === "manual") {
    requireMethod(request, "POST");
    rejectAdministrativeQuery(request.url);
    const body = await bodyJson(request);
    exactBody(body, "confirm_registered_backup_run");
    const release = admitMutation(dependencies);
    try {
      send(
        response,
        await protectedAdministration().runRegisteredBackup.execute(targetId!),
      );
    } finally {
      release();
    }
    return;
  }
  if (kind === "schedule") {
    rejectAdministrativeQuery(request.url);
    if (request.method === "GET") {
      validateAdministrativeRequestHasNoBody(request);
      send(
        response,
        await protectedAdministration().getBackupSchedule.execute(targetId!),
      );
      return;
    }
    requireMethod(request, "PUT", "DELETE");
    const body = await bodyJson(request);
    const release = admitMutation(dependencies);
    try {
      if (request.method === "PUT") {
        send(
          response,
          await protectedAdministration().setBackupSchedule.execute(
            targetId!,
            exactPolicyBody(body, "confirm_registered_backup_schedule_update"),
          ),
        );
      } else {
        exactBody(body, "confirm_registered_backup_schedule_removal");
        send(
          response,
          await protectedAdministration().removeBackupSchedule.execute(
            targetId!,
          ),
        );
      }
    } finally {
      release();
    }
    return;
  }
  if (kind === "retention") {
    rejectAdministrativeQuery(request.url);
    if (request.method === "GET") {
      validateAdministrativeRequestHasNoBody(request);
      send(
        response,
        await protectedAdministration().getBackupRetention.execute(targetId!),
      );
      return;
    }
    requireMethod(request, "PUT");
    const body = await bodyJson(request);
    const release = admitMutation(dependencies);
    try {
      send(
        response,
        await protectedAdministration().setBackupRetention.execute(
          targetId!,
          exactPolicyBody(body, "confirm_registered_backup_retention_update"),
        ),
      );
    } finally {
      release();
    }
    return;
  }
  if (kind === "prune") {
    requireMethod(request, "POST");
    rejectAdministrativeQuery(request.url);
    const body = await bodyJson(request);
    exactBody(body, "confirm_registered_backup_retention_prune");
    const release = admitMutation(dependencies);
    try {
      send(
        response,
        await protectedAdministration().pruneBackupRetention.execute(targetId!),
      );
    } finally {
      release();
    }
    return;
  }
  requireMethod(request, "POST");
  rejectAdministrativeQuery(request.url);
  const body = await bodyJson(request);
  exactBody(body, "confirm_backup_scheduler_tick");
  const release = admitMutation(dependencies);
  try {
    send(
      response,
      await protectedAdministration().runBackupSchedulerTick.execute(),
    );
  } finally {
    release();
  }
}

function requireMethod(request: Request, ...methods: string[]): void {
  if (!methods.includes(request.method)) {
    request.res?.setHeader("Allow", methods.join(", "));
    throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
  }
}
function admitMutation(
  dependencies: AdministrativeBackupsRouteDependencies,
): () => void {
  const release = dependencies.mutationGate.tryAdmit();
  if (release === undefined)
    throw new HttpError(
      409,
      "backup_operation_busy",
      "Backup operation is busy",
    );
  return release;
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
    const value =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Uint8Array);
    size += value.length;
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, "payload_too_large", "Payload too large");
    chunks.push(value);
  }
  if (!isUtf8(Buffer.concat(chunks)))
    throw new HttpError(
      400,
      "invalid_backup_request",
      "Invalid backup request",
    );
  try {
    return parseStrictJson(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_backup_request",
      "Invalid backup request",
    );
  }
}
function exactBody(input: unknown, confirmation: string): void {
  if (
    !isRecord(input) ||
    Reflect.ownKeys(input).length !== 1 ||
    input.confirmation !== confirmation
  )
    throw new HttpError(
      400,
      "invalid_backup_request",
      "Invalid backup request",
    );
}
function exactPolicyBody(input: unknown, confirmation: string): unknown {
  if (
    !isRecord(input) ||
    Reflect.ownKeys(input).length !== 2 ||
    input.confirmation !== confirmation ||
    !Object.hasOwn(input, "policy")
  )
    throw new HttpError(
      400,
      "invalid_backup_request",
      "Invalid backup request",
    );
  return input.policy;
}
function parseRunQuery(target: string): BackupRunQuery {
  const url = new URL(target, "http://127.0.0.1");
  const allowed = new Set([
    "afterSequence",
    "limit",
    "targetId",
    "status",
    "trigger",
    "startedFrom",
    "startedTo",
  ]);
  for (const key of url.searchParams.keys())
    if (!allowed.has(key))
      throw new HttpError(
        400,
        "invalid_backup_request",
        "Invalid backup request",
      );
  const number = (key: string, fallback: number): number => {
    const value = url.searchParams.get(key);
    if (value === null) return fallback;
    if (!/^\d+$/u.test(value))
      throw new HttpError(
        400,
        "invalid_backup_request",
        "Invalid backup request",
      );
    return Number(value);
  };
  return {
    afterSequence: number("afterSequence", 0),
    limit: number("limit", 50),
    ...(url.searchParams.get("targetId") === null
      ? {}
      : { targetId: url.searchParams.get("targetId")! }),
    ...(url.searchParams.get("status") === null
      ? {}
      : { status: url.searchParams.get("status") as never }),
    ...(url.searchParams.get("trigger") === null
      ? {}
      : { trigger: url.searchParams.get("trigger") as never }),
    ...(url.searchParams.get("startedFrom") === null
      ? {}
      : { startedFrom: url.searchParams.get("startedFrom")! }),
    ...(url.searchParams.get("startedTo") === null
      ? {}
      : { startedTo: url.searchParams.get("startedTo")! }),
  };
}
function isTargetId(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) &&
    value.length <= 64
  );
}
function isRunId(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  );
}
function paramString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function send(response: Response, value: unknown): void {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, "utf8") > 262_144)
    throw new HttpError(500, "internal_error", "Internal server error");
  response.type("application/json").send(body);
}
function mapError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const access = mapAdministrativeAccessControlError(error);
  if (access !== undefined) return access;
  // A rejected schedule or retention policy is the caller's input being wrong.
  // Reporting it as an unavailable backup subsystem would tell the operator to
  // retry something that can never succeed unchanged.
  if (error instanceof BackupTargetValidationError)
    return new HttpError(
      400,
      "invalid_backup_request",
      "Invalid backup request",
    );
  if (
    error instanceof Error &&
    /^(registered_backup_target_not_found|backup_run_not_found)$/u.test(
      error.message,
    )
  )
    return new HttpError(404, error.message, "Backup resource not found");
  if (error instanceof Error && error.message === "backup_operation_busy")
    return new HttpError(
      409,
      "backup_operation_busy",
      "Backup operation is busy",
    );
  return new HttpError(
    503,
    "backup_operation_unavailable",
    "Backup operation unavailable",
  );
}
