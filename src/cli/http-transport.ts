import {
  AtlasCliInterruptedError,
  AtlasCliNetworkError,
  AtlasCliTimeoutError,
  ATLAS_MUTATION_TIMEOUT_MS,
  createAtlasAdministrativeClient,
  type AtlasAdministrativeClient,
  type AtlasAdministrativeResponse,
} from "./administrative-client.js";
import {
  ATLAS_SERVICE_SCHEDULE_ALIAS_MODES,
  ATLAS_DIAGNOSTIC_CHECK_ID_PREFIX,
  ATLAS_DIAGNOSTIC_NGINX_CONFIG_CHECK_ID,
  ATLAS_INFRASTRUCTURE_DIAGNOSTICS_PATH,
  atlasDiagnosticOverallStatus,
  backupActionMutation,
  backupActionPath,
  backupRetentionMutation,
  backupRetentionPath,
  backupRetentionPrunePath,
  backupRunReadPath,
  backupScheduleMutation,
  backupSchedulePath,
  backupTargetReadPath,
  isAtlasBackupRunId,
  isAtlasBackupTargetId,
  isAtlasServiceId,
  machineScheduleMutation,
  ATLAS_MACHINE_SCHEDULE_PATH,
  ATLAS_MACHINE_SCHEDULE_PREVIEW_PATH,
  serviceActionMutation,
  serviceActionPath,
  serviceReadPath,
  serviceScheduleMutation,
  serviceSchedulePath,
  type AtlasAdministrativeMutationDescriptor,
  type AtlasBackupRetentionOperation,
  type AtlasDiagnosticStatus,
  type AtlasBackupScheduleOperation,
  type AtlasMachineScheduleOperation,
  type AtlasServiceOperation,
  type AtlasServiceScheduleOperation,
} from "./administrative-contract.js";
import { AtlasCliError } from "./errors.js";
import type { AtlasCliTransport } from "./contracts.js";

export interface AtlasHttpTransportOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  /** A real Cloudflare Access JWT held in memory for protected requests. */
  readonly administrativeAccessToken?: string;
  readonly readTimeoutMs?: number;
  readonly mutationTimeoutMs?: number;
  /**
   * Bound for the one administrative mutation that does its work inside the
   * request (a manual backup run). Defaults to the larger of
   * `ATLAS_BACKUP_RUN_TIMEOUT_MS` and the configured mutation timeout, so a
   * deliberately longer global timeout is never silently shortened.
   */
  readonly backupRunTimeoutMs?: number;
}

/**
 * A synchronous manual backup can legitimately take minutes for a
 * `filesystem_tree` target, so the general mutation bound would abandon a run
 * that is still working and force the operator to reconcile an outcome that
 * was never actually in doubt.
 */
export const ATLAS_BACKUP_RUN_TIMEOUT_MS = 300_000;

export function createAtlasHttpTransport(
  options: AtlasHttpTransportOptions = {},
): AtlasCliTransport {
  const client = createAtlasAdministrativeClient(options);
  const backupRunTimeoutMs =
    options.backupRunTimeoutMs ??
    Math.max(
      ATLAS_BACKUP_RUN_TIMEOUT_MS,
      options.mutationTimeoutMs ?? ATLAS_MUTATION_TIMEOUT_MS,
    );
  return Object.freeze({
    execute: (command: string, args: readonly string[], signal: AbortSignal) =>
      executeHttpCommand(client, command, args, signal, { backupRunTimeoutMs }),
  });
}

type AtlasTransportBounds = Readonly<{ backupRunTimeoutMs: number }>;

async function executeHttpCommand(
  client: AtlasAdministrativeClient,
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  bounds: AtlasTransportBounds,
): Promise<unknown> {
  switch (command) {
    case "health":
      return readHealth(client, signal);
    case "status":
      return readStatus(client, signal);
    case "doctor":
      return readDoctor(client, signal);
    case "services list":
      return client.read("/admin/services", signal);
    case "services status": {
      const serviceId = requireArgument(args, "service id");
      return client.read(serviceReadPath(serviceId), signal);
    }
    case "services logs": {
      const serviceId = requireArgument(args, "service id");
      return client.read(
        `/admin/services/${encodeURIComponent(serviceId)}/logs`,
        signal,
      );
    }
    case "services start":
    case "services stop":
    case "services restart":
      return executeServiceAction(
        client,
        command.slice("services ".length) as AtlasServiceOperation,
        args,
        signal,
      );
    case "services schedule show": {
      const serviceId = requireArgument(args, "service id");
      return client.read(
        `/admin/services/${encodeURIComponent(serviceId)}/schedule`,
        signal,
      );
    }
    case "services schedule preview": {
      const serviceId = requireArgument(args, "service id");
      const preview = readPreviewOptions(args.slice(1));
      if (preview.candidatePolicy === undefined)
        return client.read(
          `/admin/services/${encodeURIComponent(serviceId)}/availability/preview?startsAt=${encodeURIComponent(preview.startsAt)}&endsAt=${encodeURIComponent(preview.endsAt)}`,
          signal,
        );
      return client.read(
        `/admin/services/${encodeURIComponent(serviceId)}/schedule/preview?startsAt=${encodeURIComponent(preview.startsAt)}&endsAt=${encodeURIComponent(preview.endsAt)}&policy=${encodeURIComponent(preview.candidatePolicy)}`,
        signal,
      );
    }
    case "services schedule set":
      return executeServiceScheduleSet(client, args, signal);
    case "services schedule always":
    case "services schedule manual":
    case "services schedule disable":
      return executeServiceScheduleAlias(
        client,
        command.slice("services schedule ".length) as
          "always" | "manual" | "disable",
        args,
        signal,
      );
    case "services schedule remove":
      return executeServiceScheduleRemove(client, args, signal);
    case "backups list":
      return client.read("/admin/backups/targets", signal);
    case "backups status":
      return readOverviewField(client, "backups", signal);
    case "backups runs":
      return client.read("/admin/backups/runs?limit=50", signal);
    case "backups run":
      return executeBackupRun(client, args, signal, bounds.backupRunTimeoutMs);
    case "backups run-status":
      return executeBackupRunStatus(client, args, signal);
    case "backups schedule show": {
      const targetId = requireBackupTargetIdArgument(args);
      return client.read(backupSchedulePath(targetId), signal);
    }
    case "backups schedule set":
      return executeBackupScheduleSet(client, args, signal);
    case "backups schedule remove":
      return executeBackupScheduleRemove(client, args, signal);
    case "backups retention show": {
      const targetId = requireBackupTargetIdArgument(args);
      return client.read(backupRetentionPath(targetId), signal);
    }
    case "backups retention set":
      return executeBackupRetentionSet(client, args, signal);
    case "backups retention prune":
      return executeBackupRetentionPrune(client, args, signal);
    case "events": {
      const limit = args.includes("--tail") ? 100 : 20;
      return client.read(`/admin/event-history?limit=${limit}`, signal);
    }
    case "infra status":
      return readInfraStatus(client, signal);
    case "infra listeners":
      return readDiagnosticSubset(client, signal, (id) =>
        id.startsWith(ATLAS_DIAGNOSTIC_CHECK_ID_PREFIX.listener),
      );
    case "nginx status":
      return readDiagnosticSubset(client, signal, (id) =>
        id.startsWith(ATLAS_DIAGNOSTIC_CHECK_ID_PREFIX.nginx),
      );
    case "nginx test":
      return readDiagnosticSubset(
        client,
        signal,
        (id) => id === ATLAS_DIAGNOSTIC_NGINX_CONFIG_CHECK_ID,
      );
    case "tunnel status":
      return readDiagnosticSubset(client, signal, (id) =>
        id.startsWith(ATLAS_DIAGNOSTIC_CHECK_ID_PREFIX.tunnel),
      );
    case "machine plan":
      return readOverviewField(client, "machinePlan", signal);
    case "machine status":
      return readOverviewField(client, "powerSafety", signal);
    case "machine schedule show":
      return readOverviewField(client, "machineSchedule", signal);
    case "machine schedule preview": {
      const preview = readMachineSchedulePreviewOptions(args);
      return client.read(
        `${ATLAS_MACHINE_SCHEDULE_PREVIEW_PATH}?policy=${encodeURIComponent(preview.policy)}`,
        signal,
      );
    }
    case "machine schedule set":
      return executeMachineScheduleSet(client, args, signal);
    case "machine schedule remove":
      return executeMachineScheduleRemove(client, signal);
    default:
      throw new AtlasCliError(
        "command_not_implemented",
        `Command not implemented yet: ${command}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Registered-service mutations (ADR-031)
// ---------------------------------------------------------------------------

export type AtlasServiceMutationResult = Readonly<{
  serviceId: string;
  displayName: string | undefined;
  operation: AtlasServiceOperation;
  result: "completed";
  /** Authoritative post-mutation state, or `unknown` when the re-read failed. */
  state: string;
  availability: string | undefined;
  authoritativeRead: "ok" | "unavailable";
}>;

async function executeServiceAction(
  client: AtlasAdministrativeClient,
  operation: AtlasServiceOperation,
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasServiceMutationResult> {
  const serviceId = requireServiceIdArgument(args);
  // Before any network activity at all: an insecure base URL must not even
  // produce a pre-check request.
  client.assertMutationAllowed();

  // Advisory pre-check. It exists to avoid dispatching an operation the
  // registered service cannot perform and to give the operator a precise
  // error, mirroring how the dashboard hides unsupported controls. It never
  // becomes the authority: only a definitive answer (authorization refusal,
  // service absent, operation unsupported) stops the command. Any other
  // pre-check problem is ignored so that a degraded read path cannot make a
  // service unmanageable during an incident.
  const precheck = await describeServiceSafely(client, serviceId, signal, true);
  if (precheck.kind === "denied")
    throw new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (precheck.kind === "absent")
    throw new AtlasCliError(
      "service_not_found",
      `Registered service not found: ${serviceId}`,
    );
  if (
    precheck.kind === "described" &&
    !precheck.supportedOperations.includes(operation)
  )
    throw new AtlasCliError(
      "service_operation_unsupported",
      `Registered service ${serviceId} does not support ${operation}`,
    );

  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.mutate(
      {
        descriptor: serviceActionMutation(operation),
        path: serviceActionPath(operation, serviceId),
      },
      signal,
    );
  } catch (error) {
    // A mutation is never retried here. `state_recheck_required` means the
    // operator, not the CLI, decides what happens after an uncertain result.
    throw mapMutationDispatchError(
      error,
      `${operation} request for ${serviceId}`,
      `Re-read authoritative state with: atlas services status ${serviceId}`,
    );
  }

  if (envelope.status < 200 || envelope.status >= 300)
    throw mapMutationRejection(envelope, serviceId);
  if (envelope.malformed)
    throw new AtlasCliError(
      "service_operation_failed",
      "Atlas returned an unreadable service operation response",
    );
  const accepted = readMutationAcknowledgement(envelope.body);
  if (accepted === undefined)
    throw new AtlasCliError(
      "service_operation_failed",
      "Atlas returned an unexpected service operation response",
    );
  if (!accepted)
    throw new AtlasCliError(
      "service_operation_failed",
      `Atlas reported the ${operation} operation for ${serviceId} as unsuccessful`,
    );

  // Success is never claimed from an HTTP status alone (ADR-031).
  const authoritative = await describeServiceSafely(
    client,
    serviceId,
    signal,
    false,
  );
  return Object.freeze({
    serviceId,
    displayName:
      authoritative.kind === "described"
        ? authoritative.displayName
        : precheck.kind === "described"
          ? precheck.displayName
          : undefined,
    operation,
    result: "completed" as const,
    state: authoritative.kind === "described" ? authoritative.state : "unknown",
    availability:
      authoritative.kind === "described"
        ? authoritative.availability
        : undefined,
    authoritativeRead:
      authoritative.kind === "described" ? "ok" : "unavailable",
  });
}

type ServiceDescription =
  | Readonly<{
      kind: "described";
      displayName: string | undefined;
      state: string;
      availability: string | undefined;
      supportedOperations: readonly string[];
    }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "indeterminate" }>;

async function describeServiceSafely(
  client: AtlasAdministrativeClient,
  serviceId: string,
  signal: AbortSignal,
  /**
   * Whether an interruption should abort the command. True before a mutation
   * (nothing has happened yet, so cancelling is safe and honest); false after
   * one, where the mutation already succeeded and only the confirming read was
   * lost.
   */
  propagateInterruption: boolean,
): Promise<ServiceDescription> {
  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.readEnvelope(serviceReadPath(serviceId), signal);
  } catch (error) {
    if (propagateInterruption && error instanceof AtlasCliInterruptedError)
      throw error;
    return Object.freeze({ kind: "indeterminate" as const });
  }
  if (envelope.status === 401 || envelope.status === 403)
    return Object.freeze({ kind: "denied" as const });
  if (
    envelope.status === 404 &&
    envelope.errorCode === "registered_service_not_found"
  )
    return Object.freeze({ kind: "absent" as const });
  if (envelope.status !== 200 || envelope.malformed)
    return Object.freeze({ kind: "indeterminate" as const });
  const service = readServiceRecord(envelope.body);
  if (service === undefined)
    return Object.freeze({ kind: "indeterminate" as const });
  return service;
}

function readServiceRecord(body: unknown): ServiceDescription | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const service = (body as Record<string, unknown>).service;
  if (typeof service !== "object" || service === null) return undefined;
  const record = service as Record<string, unknown>;
  if (typeof record.status !== "string") return undefined;
  const supportedOperations = Array.isArray(record.supportedOperations)
    ? record.supportedOperations.filter(
        (value): value is string => typeof value === "string",
      )
    : undefined;
  if (supportedOperations === undefined) return undefined;
  return Object.freeze({
    kind: "described" as const,
    displayName:
      typeof record.displayName === "string" ? record.displayName : undefined,
    state: record.status,
    availability:
      typeof record.availability === "string" ? record.availability : undefined,
    supportedOperations: Object.freeze(supportedOperations),
  });
}

function readMutationAcknowledgement(body: unknown): boolean | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const successful = (body as Record<string, unknown>).successful;
  return typeof successful === "boolean" ? successful : undefined;
}

/**
 * Classifies a mutation that never produced a response. Delivery is only ever
 * treated as *not* having happened when the transport proved it; every other
 * outcome is indeterminate and directs the operator at an authoritative re-read.
 *
 * `subject` names the dispatched work ("restart request for task-manager") and
 * `recheck` is the exact command that resolves the ambiguity.
 */
function mapMutationDispatchError(
  error: unknown,
  subject: string,
  recheck: string,
): Error {
  if (error instanceof AtlasCliInterruptedError)
    return new AtlasCliError(
      "mutation_interrupted_outcome_unknown",
      `Interrupted after the ${subject} may have been sent. ${recheck}`,
    );
  if (error instanceof AtlasCliTimeoutError)
    return new AtlasCliError(
      "mutation_outcome_unknown",
      `The ${subject} timed out and may still have been applied. ${recheck}`,
    );
  if (error instanceof AtlasCliNetworkError)
    return error.undelivered
      ? new AtlasCliError(
          "infrastructure_unavailable",
          "Atlas endpoint unavailable; the operation was not delivered",
        )
      : new AtlasCliError(
          "mutation_outcome_unknown",
          `The ${subject} failed in transit and may still have been applied. ${recheck}`,
        );
  if (error instanceof AtlasCliError) return error;
  return new AtlasCliError(
    "mutation_outcome_unknown",
    `The ${subject} did not complete and may still have been applied. ${recheck}`,
  );
}

function mapMutationRejection(
  envelope: AtlasAdministrativeResponse,
  serviceId: string,
): AtlasCliError {
  if (envelope.status === 401 || envelope.status === 403)
    return new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (envelope.status === 404)
    return new AtlasCliError(
      "service_not_found",
      `Registered service not found: ${serviceId}`,
    );
  if (envelope.status === 409 || envelope.status === 429)
    return new AtlasCliError(
      "operation_conflict",
      envelope.status === 429
        ? "Atlas is rate limiting administrative requests; retry shortly"
        : "Another administrative service operation is in progress",
    );
  // The audit trail could not durably record a mutation that may already have
  // taken effect. Reporting this as a failure would be wrong.
  if (envelope.errorCode === "administrative_service_state_recheck_required")
    return new AtlasCliError(
      "mutation_outcome_unknown",
      `Atlas could not confirm the outcome. Re-read authoritative state with: atlas services status ${serviceId}`,
    );
  return new AtlasCliError(
    "service_operation_failed",
    `Atlas rejected the service operation (HTTP ${envelope.status}${
      envelope.errorCode === undefined ? "" : `, ${envelope.errorCode}`
    })`,
  );
}

// ---------------------------------------------------------------------------
// Registered-service schedule mutations (ADR-031)
// ---------------------------------------------------------------------------

export type AtlasServiceScheduleMutationResult = Readonly<{
  serviceId: string;
  operation: AtlasServiceScheduleOperation;
  result: "completed";
  /**
   * Authoritative post-mutation policy mode, or `unknown` when the confirming
   * re-read failed. For `delete` this is the *fallback* policy the service
   * reverts to, which is its statically configured default — not necessarily
   * the mode any alias subcommand would have written.
   */
  mode: string;
  /** Full authoritative policy, when the re-read succeeded. */
  policy: unknown;
  authoritativeRead: "ok" | "unavailable";
}>;

async function executeServiceScheduleSet(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasServiceScheduleMutationResult> {
  const parsed = readSchedulePolicyArguments(args);
  return putServiceSchedule(client, parsed.serviceId, parsed.policy, signal);
}

async function executeServiceScheduleAlias(
  client: AtlasAdministrativeClient,
  alias: "always" | "manual" | "disable",
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasServiceScheduleMutationResult> {
  const serviceId = requireServiceIdArgument(args);
  // The subcommand word is mapped to a domain mode explicitly; `disable` is
  // not the same string as the stored mode `disabled`.
  return putServiceSchedule(
    client,
    serviceId,
    { mode: ATLAS_SERVICE_SCHEDULE_ALIAS_MODES[alias] },
    signal,
  );
}

async function putServiceSchedule(
  client: AtlasAdministrativeClient,
  serviceId: string,
  policy: unknown,
  signal: AbortSignal,
): Promise<AtlasServiceScheduleMutationResult> {
  return mutateServiceSchedule(client, serviceId, "update", signal, {
    // The CLI forwards the policy verbatim and validates none of its content:
    // the server's schedule domain is the single validation authority, so a
    // CLI copy of those rules could only ever drift away from it.
    policy,
  });
}

async function executeServiceScheduleRemove(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasServiceScheduleMutationResult> {
  const serviceId = requireServiceIdArgument(args);
  // Deliberately no `policy` key at all. Removing a schedule erases the stored
  // override so the service falls back to its configured default policy; it is
  // not the same operation as writing mode `disabled`.
  return mutateServiceSchedule(client, serviceId, "delete", signal, undefined);
}

async function mutateServiceSchedule(
  client: AtlasAdministrativeClient,
  serviceId: string,
  operation: AtlasServiceScheduleOperation,
  signal: AbortSignal,
  payload: Readonly<Record<string, unknown>> | undefined,
): Promise<AtlasServiceScheduleMutationResult> {
  client.assertMutationAllowed();

  // Advisory pre-check, exactly as for service actions. A schedule has no
  // per-service capability gate — a registered service either exists or does
  // not — so there is no "unsupported operation" branch here.
  const precheck = await describeServiceSafely(client, serviceId, signal, true);
  if (precheck.kind === "denied")
    throw new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (precheck.kind === "absent")
    throw new AtlasCliError(
      "service_not_found",
      `Registered service not found: ${serviceId}`,
    );

  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.mutate(
      {
        descriptor: serviceScheduleMutation(operation),
        path: serviceSchedulePath(serviceId),
        ...(payload === undefined ? {} : { payload }),
      },
      signal,
    );
  } catch (error) {
    throw mapMutationDispatchError(
      error,
      `schedule ${operation} request for ${serviceId}`,
      `Re-read authoritative state with: atlas services schedule show ${serviceId}`,
    );
  }

  if (envelope.status < 200 || envelope.status >= 300)
    throw mapScheduleMutationRejection(envelope, serviceId);
  if (envelope.malformed)
    throw new AtlasCliError(
      "service_operation_failed",
      "Atlas returned an unreadable service schedule response",
    );
  if (!hasScheduleMutationAcknowledgement(envelope.body, operation))
    throw new AtlasCliError(
      "service_operation_failed",
      "Atlas returned an unexpected service schedule response",
    );

  // Success is never claimed from the mutation response alone (ADR-031): the
  // stored policy is read back from the authoritative schedule route.
  const authoritative = await describeServiceScheduleSafely(
    client,
    serviceId,
    signal,
  );
  return Object.freeze({
    serviceId,
    operation,
    result: "completed" as const,
    mode: authoritative.kind === "described" ? authoritative.mode : "unknown",
    policy: authoritative.kind === "described" ? authoritative.policy : null,
    authoritativeRead:
      authoritative.kind === "described" ? "ok" : "unavailable",
  });
}

type ServiceScheduleDescription =
  | Readonly<{ kind: "described"; mode: string; policy: unknown }>
  | Readonly<{ kind: "indeterminate" }>;

/**
 * Authoritative post-mutation read of the stored schedule. Interruption is
 * never propagated: the mutation already happened, and only the confirming
 * read was lost.
 */
async function describeServiceScheduleSafely(
  client: AtlasAdministrativeClient,
  serviceId: string,
  signal: AbortSignal,
): Promise<ServiceScheduleDescription> {
  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.readEnvelope(
      serviceSchedulePath(serviceId),
      signal,
    );
  } catch {
    return Object.freeze({ kind: "indeterminate" as const });
  }
  if (envelope.status !== 200 || envelope.malformed)
    return Object.freeze({ kind: "indeterminate" as const });
  if (typeof envelope.body !== "object" || envelope.body === null)
    return Object.freeze({ kind: "indeterminate" as const });
  const policy = (envelope.body as Record<string, unknown>).policy;
  if (typeof policy !== "object" || policy === null)
    return Object.freeze({ kind: "indeterminate" as const });
  const mode = (policy as Record<string, unknown>).mode;
  if (typeof mode !== "string")
    return Object.freeze({ kind: "indeterminate" as const });
  return Object.freeze({ kind: "described" as const, mode, policy });
}

/**
 * The schedule routes do not answer with a `successful` boolean the way the
 * service action routes do. A `PUT` answers with the persisted policy itself,
 * and a `DELETE` answers with `{serviceId, removed: true}`; both are verified
 * here rather than assumed from the HTTP status.
 */
function hasScheduleMutationAcknowledgement(
  body: unknown,
  operation: AtlasServiceScheduleOperation,
): boolean {
  if (typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;
  if (operation === "delete") return record.removed === true;
  return typeof record.mode === "string";
}

function mapScheduleMutationRejection(
  envelope: AtlasAdministrativeResponse,
  serviceId: string,
): AtlasCliError {
  if (envelope.status === 401 || envelope.status === 403)
    return new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (envelope.status === 404)
    return new AtlasCliError(
      "service_not_found",
      `Registered service not found: ${serviceId}`,
    );
  if (envelope.status === 409 || envelope.status === 429)
    return new AtlasCliError(
      "operation_conflict",
      envelope.status === 429
        ? "Atlas is rate limiting administrative requests; retry shortly"
        : "Another administrative service operation is in progress",
    );
  // The server rejected the policy itself. This is the operator's input being
  // wrong, not the schedule subsystem failing.
  if (
    envelope.status === 400 &&
    envelope.errorCode === "invalid_service_schedule_request"
  )
    return new AtlasCliError(
      "schedule_invalid",
      "Atlas rejected the service schedule policy as invalid",
    );
  if (envelope.errorCode === "administrative_service_state_recheck_required")
    return new AtlasCliError(
      "mutation_outcome_unknown",
      `Atlas could not confirm the outcome. Re-read authoritative state with: atlas services schedule show ${serviceId}`,
    );
  return new AtlasCliError(
    "service_operation_failed",
    `Atlas rejected the service schedule mutation (HTTP ${envelope.status}${
      envelope.errorCode === undefined ? "" : `, ${envelope.errorCode}`
    })`,
  );
}

// ---------------------------------------------------------------------------
// Machine operating policy (schedule) mutations (ADR-033)
// ---------------------------------------------------------------------------

export type AtlasMachineScheduleMutationResult = Readonly<{
  operation: AtlasMachineScheduleOperation;
  result: "completed";
  /**
   * Authoritative post-mutation policy mode, or `unknown` when the confirming
   * re-read failed. For `delete` this is the *fallback* policy the machine
   * reverts to: the statically configured `MACHINE_OPERATING_POLICY`
   * environment default.
   */
  mode: string;
  /** Full authoritative resolved policy, when the re-read succeeded. */
  policy: unknown;
  authoritativeRead: "ok" | "unavailable";
}>;

async function executeMachineScheduleSet(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasMachineScheduleMutationResult> {
  const policy = readMachineSchedulePolicyArgument(args);
  return mutateMachineSchedule(client, "update", signal, { policy });
}

async function executeMachineScheduleRemove(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
): Promise<AtlasMachineScheduleMutationResult> {
  // Deliberately no `policy` key: removing the persisted override lets the
  // machine fall back to its environment-configured default policy.
  return mutateMachineSchedule(client, "delete", signal, undefined);
}

async function mutateMachineSchedule(
  client: AtlasAdministrativeClient,
  operation: AtlasMachineScheduleOperation,
  signal: AbortSignal,
  payload: Readonly<Record<string, unknown>> | undefined,
): Promise<AtlasMachineScheduleMutationResult> {
  client.assertMutationAllowed();

  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.mutate(
      {
        descriptor: machineScheduleMutation(operation),
        path: ATLAS_MACHINE_SCHEDULE_PATH,
        ...(payload === undefined ? {} : { payload }),
      },
      signal,
    );
  } catch (error) {
    throw mapMutationDispatchError(
      error,
      `machine schedule ${operation} request`,
      "Re-read authoritative state with: atlas machine schedule show",
    );
  }

  if (envelope.status < 200 || envelope.status >= 300)
    throw mapMachineScheduleMutationRejection(envelope);
  if (envelope.malformed)
    throw new AtlasCliError(
      "service_operation_failed",
      "Atlas returned an unreadable machine schedule response",
    );
  if (!hasMachineScheduleMutationAcknowledgement(envelope.body, operation))
    throw new AtlasCliError(
      "service_operation_failed",
      "Atlas returned an unexpected machine schedule response",
    );

  // Success is never claimed from the mutation response alone (ADR-031): the
  // resolved policy is read back from the authoritative schedule route.
  const authoritative = await describeMachineScheduleSafely(client, signal);
  return Object.freeze({
    operation,
    result: "completed" as const,
    mode: authoritative.kind === "described" ? authoritative.mode : "unknown",
    policy: authoritative.kind === "described" ? authoritative.policy : null,
    authoritativeRead:
      authoritative.kind === "described" ? "ok" : "unavailable",
  });
}

type MachineScheduleDescription =
  | Readonly<{ kind: "described"; mode: string; policy: unknown }>
  | Readonly<{ kind: "indeterminate" }>;

async function describeMachineScheduleSafely(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
): Promise<MachineScheduleDescription> {
  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.readEnvelope(ATLAS_MACHINE_SCHEDULE_PATH, signal);
  } catch {
    return Object.freeze({ kind: "indeterminate" as const });
  }
  if (envelope.status !== 200 || envelope.malformed)
    return Object.freeze({ kind: "indeterminate" as const });
  if (typeof envelope.body !== "object" || envelope.body === null)
    return Object.freeze({ kind: "indeterminate" as const });
  const policy = (envelope.body as Record<string, unknown>).policy;
  if (typeof policy !== "object" || policy === null)
    return Object.freeze({ kind: "indeterminate" as const });
  const mode = (policy as Record<string, unknown>).mode;
  if (typeof mode !== "string")
    return Object.freeze({ kind: "indeterminate" as const });
  return Object.freeze({ kind: "described" as const, mode, policy });
}

/**
 * A `PUT` answers with the persisted policy itself (`{mode, ...}`); a
 * `DELETE` answers with `{removed: true}` -- both are verified here rather
 * than assumed from the HTTP status, mirroring
 * `hasScheduleMutationAcknowledgement`.
 */
function hasMachineScheduleMutationAcknowledgement(
  body: unknown,
  operation: AtlasMachineScheduleOperation,
): boolean {
  if (typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;
  if (operation === "delete") return record.removed === true;
  return typeof record.mode === "string";
}

function mapMachineScheduleMutationRejection(
  envelope: AtlasAdministrativeResponse,
): AtlasCliError {
  if (envelope.status === 401 || envelope.status === 403)
    return new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (envelope.status === 409 || envelope.status === 429)
    return new AtlasCliError(
      "operation_conflict",
      envelope.status === 429
        ? "Atlas is rate limiting administrative requests; retry shortly"
        : "Another administrative machine schedule operation is in progress",
    );
  if (
    envelope.status === 400 &&
    envelope.errorCode === "invalid_machine_schedule_request"
  )
    return new AtlasCliError(
      "schedule_invalid",
      "Atlas rejected the machine schedule policy as invalid",
    );
  if (envelope.errorCode === "administrative_service_state_recheck_required")
    return new AtlasCliError(
      "mutation_outcome_unknown",
      "Atlas could not confirm the outcome. Re-read authoritative state with: atlas machine schedule show",
    );
  return new AtlasCliError(
    "service_operation_failed",
    `Atlas rejected the machine schedule mutation (HTTP ${envelope.status}${
      envelope.errorCode === undefined ? "" : `, ${envelope.errorCode}`
    })`,
  );
}

function readMachineSchedulePolicyArgument(args: readonly string[]): unknown {
  if (args.length !== 2 || args[0] !== "--policy")
    throw new AtlasCliError(
      "invalid_arguments",
      args.length > 0 && args[0] !== "--policy" && args[0]?.startsWith("-")
        ? `Unknown option: ${String(args[0])}`
        : "Option --policy <json> is required",
    );
  try {
    return JSON.parse(args[1] as string) as unknown;
  } catch {
    throw new AtlasCliError(
      "invalid_arguments",
      "Option --policy requires valid JSON",
    );
  }
}

function readMachineSchedulePreviewOptions(
  args: readonly string[],
): Readonly<{ policy: string }> {
  if (args.length !== 2 || args[0] !== "--policy")
    throw new AtlasCliError(
      "invalid_arguments",
      args.length > 0 && args[0] !== "--policy" && args[0]?.startsWith("-")
        ? `Unknown option: ${String(args[0])}`
        : "Option --policy <json> is required",
    );
  return Object.freeze({ policy: args[1] as string });
}

// ---------------------------------------------------------------------------
// Registered-backup operations (ADR-031)
// ---------------------------------------------------------------------------

/**
 * A manual backup run is synchronous server-side: the request blocks until the
 * run reaches a terminal state and answers with the terminal run record. There
 * is therefore no queue, no poll, and — unlike every other mutation here — no
 * separate authoritative re-read, because the response body *is* the
 * authoritative result (ADR-031 permits this divergence for a synchronous
 * mutation whose response is itself the post-state).
 *
 * Because the work happens inside the request, this one call site raises the
 * bounded mutation timeout (see `ATLAS_BACKUP_RUN_TIMEOUT_MS`). It never
 * removes the bound.
 */
export type AtlasBackupRunResult = Readonly<{
  targetId: string;
  runId: string;
  trigger: string | undefined;
  /** Terminal run status, reported exactly as the server recorded it. */
  status: string;
  startedAt: string | undefined;
  completedAt: string | undefined;
  fileCount: number | undefined;
  totalBytes: number | undefined;
  manifestSha256: string | undefined;
}>;

async function executeBackupRun(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<AtlasBackupRunResult> {
  const targetId = requireBackupTargetIdArgument(args);
  client.assertMutationAllowed();

  const precheck = await describeBackupTargetSafely(client, targetId, signal);
  if (precheck.kind === "denied")
    throw new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (precheck.kind === "absent")
    throw new AtlasCliError(
      "backup_target_not_found",
      `Registered backup target not found: ${targetId}`,
    );
  if (precheck.kind === "described" && !precheck.manualRun)
    throw new AtlasCliError(
      "backup_operation_unsupported",
      `Registered backup target ${targetId} does not support a manual run`,
    );

  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.mutate(
      {
        descriptor: backupActionMutation("run"),
        path: backupActionPath("run", targetId),
      },
      signal,
      timeoutMs,
    );
  } catch (error) {
    throw mapMutationDispatchError(
      error,
      `backup run request for ${targetId}`,
      `Find the run with: atlas backups runs — then confirm its outcome with: atlas backups run-status <runId>`,
    );
  }

  if (envelope.status < 200 || envelope.status >= 300)
    throw mapBackupRejection(envelope, targetId);
  if (envelope.malformed)
    throw new AtlasCliError(
      "backup_operation_failed",
      "Atlas returned an unreadable backup run response",
    );
  const run = readBackupRunRecord(envelope.body);
  if (run === undefined)
    throw new AtlasCliError(
      "backup_operation_failed",
      "Atlas returned an unexpected backup run response",
    );
  // The status is never reinterpreted. A terminal run that did not succeed is
  // reported as a failure carrying the server's own status, never as a
  // completed backup.
  if (run.status !== "succeeded")
    throw new AtlasCliError(
      "backup_operation_failed",
      `Backup run ${run.runId} for ${targetId} finished with status ${run.status}${
        run.failureCode === undefined ? "" : ` (${run.failureCode})`
      }`,
    );
  return Object.freeze({
    targetId,
    runId: run.runId,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    fileCount: run.fileCount,
    totalBytes: run.totalBytes,
    manifestSha256: run.manifestSha256,
  });
}

/** Read-only lookup of a single run. No mutation, no gate, no confirmation. */
async function executeBackupRunStatus(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
): Promise<unknown> {
  const runId = requireSingleArgument(args, "run id");
  if (!isAtlasBackupRunId(runId))
    throw new AtlasCliError("invalid_arguments", `Invalid run id: ${runId}`);
  const envelope = await client.readEnvelope(backupRunReadPath(runId), signal);
  if (envelope.status === 401 || envelope.status === 403)
    throw new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (envelope.status === 404)
    throw new AtlasCliError(
      "backup_run_not_found",
      `Backup run not found: ${runId}`,
    );
  if (envelope.status !== 200 || envelope.malformed)
    throw new AtlasCliError(
      "infrastructure_unavailable",
      `Atlas endpoint returned HTTP ${envelope.status}`,
    );
  return envelope.body;
}

type BackupTargetDescription =
  | Readonly<{ kind: "described"; manualRun: boolean; schedule: boolean }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "indeterminate" }>;

/**
 * Advisory pre-check against the registered target, mirroring how the
 * dashboard hides a control the target does not offer. Only a definitive
 * answer stops the command; a degraded read never makes a target unusable.
 */
async function describeBackupTargetSafely(
  client: AtlasAdministrativeClient,
  targetId: string,
  signal: AbortSignal,
): Promise<BackupTargetDescription> {
  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.readEnvelope(
      backupTargetReadPath(targetId),
      signal,
    );
  } catch (error) {
    if (error instanceof AtlasCliInterruptedError) throw error;
    return Object.freeze({ kind: "indeterminate" as const });
  }
  if (envelope.status === 401 || envelope.status === 403)
    return Object.freeze({ kind: "denied" as const });
  if (
    envelope.status === 404 &&
    envelope.errorCode === "registered_backup_target_not_found"
  )
    return Object.freeze({ kind: "absent" as const });
  if (
    envelope.status !== 200 ||
    envelope.malformed ||
    typeof envelope.body !== "object" ||
    envelope.body === null
  )
    return Object.freeze({ kind: "indeterminate" as const });
  const capabilities = (envelope.body as Record<string, unknown>).capabilities;
  if (typeof capabilities !== "object" || capabilities === null)
    return Object.freeze({ kind: "indeterminate" as const });
  const record = capabilities as Record<string, unknown>;
  if (
    typeof record.manualRun !== "boolean" ||
    typeof record.schedule !== "boolean"
  )
    return Object.freeze({ kind: "indeterminate" as const });
  return Object.freeze({
    kind: "described" as const,
    manualRun: record.manualRun,
    schedule: record.schedule,
  });
}

type BackupRunRecord = Readonly<{
  runId: string;
  status: string;
  trigger: string | undefined;
  startedAt: string | undefined;
  completedAt: string | undefined;
  failureCode: string | undefined;
  fileCount: number | undefined;
  totalBytes: number | undefined;
  manifestSha256: string | undefined;
}>;

/**
 * The run route answers with the use case's result, `{run, artifactDirectory}`.
 * The artifact directory is deliberately not surfaced: it is a host filesystem
 * path, and the CLI's vocabulary is registered identities, never paths.
 */
function readBackupRunRecord(body: unknown): BackupRunRecord | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const run = (body as Record<string, unknown>).run;
  if (typeof run !== "object" || run === null) return undefined;
  const record = run as Record<string, unknown>;
  if (typeof record.runId !== "string" || typeof record.status !== "string")
    return undefined;
  const artifact =
    typeof record.artifact === "object" && record.artifact !== null
      ? (record.artifact as Record<string, unknown>)
      : undefined;
  return Object.freeze({
    runId: record.runId,
    status: record.status,
    trigger: optionalString(record.trigger),
    startedAt: optionalString(record.startedAt),
    completedAt: optionalString(record.completedAt),
    failureCode: optionalString(record.failureCode),
    fileCount: optionalNumber(artifact?.fileCount),
    totalBytes: optionalNumber(artifact?.totalBytes),
    manifestSha256: optionalString(artifact?.manifestSha256),
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function mapBackupRejection(
  envelope: AtlasAdministrativeResponse,
  targetId: string,
): AtlasCliError {
  if (envelope.status === 401 || envelope.status === 403)
    return new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (envelope.status === 404)
    return new AtlasCliError(
      "backup_target_not_found",
      `Registered backup target not found: ${targetId}`,
    );
  // The backup gate is separate from the service mutation gate, so a busy
  // backup never reflects a busy service operation and vice versa.
  if (envelope.status === 409 || envelope.status === 429)
    return new AtlasCliError(
      "operation_conflict",
      envelope.status === 429
        ? "Atlas is rate limiting administrative requests; retry shortly"
        : "Another backup operation is in progress",
    );
  return new AtlasCliError(
    "backup_operation_failed",
    `Atlas rejected the backup operation (HTTP ${envelope.status}${
      envelope.errorCode === undefined ? "" : `, ${envelope.errorCode}`
    })`,
  );
}

// ---------------------------------------------------------------------------
// Backup schedule and retention mutations (ADR-031)
// ---------------------------------------------------------------------------

export type AtlasBackupPolicyMutationResult = Readonly<{
  targetId: string;
  operation: AtlasBackupScheduleOperation | AtlasBackupRetentionOperation;
  result: "completed";
  /** Authoritative stored policy, or `null` when the re-read failed. */
  policy: unknown;
  authoritativeRead: "ok" | "unavailable";
}>;

async function executeBackupScheduleSet(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasBackupPolicyMutationResult> {
  const parsed = readBackupPolicyArguments(args);
  return mutateBackupPolicy(client, {
    targetId: parsed.targetId,
    descriptor: backupScheduleMutation("update"),
    operation: "update",
    path: backupSchedulePath(parsed.targetId),
    readPath: backupSchedulePath(parsed.targetId),
    // Forwarded verbatim; the backup domain is the single validation authority.
    payload: { policy: parsed.policy },
    requiresScheduleCapability: true,
    signal,
  });
}

async function executeBackupScheduleRemove(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasBackupPolicyMutationResult> {
  const targetId = requireBackupTargetIdArgument(args);
  // No `policy` key at all: removal resets the target to its `manual` default.
  return mutateBackupPolicy(client, {
    targetId,
    descriptor: backupScheduleMutation("delete"),
    operation: "delete",
    path: backupSchedulePath(targetId),
    readPath: backupSchedulePath(targetId),
    payload: undefined,
    requiresScheduleCapability: true,
    signal,
  });
}

async function executeBackupRetentionSet(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasBackupPolicyMutationResult> {
  const parsed = readBackupPolicyArguments(args);
  return mutateBackupPolicy(client, {
    targetId: parsed.targetId,
    descriptor: backupRetentionMutation("update"),
    operation: "update",
    path: backupRetentionPath(parsed.targetId),
    readPath: backupRetentionPath(parsed.targetId),
    payload: { policy: parsed.policy },
    // Every registered target carries a retention policy, so there is no
    // capability gate to check here.
    requiresScheduleCapability: false,
    signal,
  });
}

async function mutateBackupPolicy(
  client: AtlasAdministrativeClient,
  input: Readonly<{
    targetId: string;
    descriptor: AtlasAdministrativeMutationDescriptor;
    operation: AtlasBackupScheduleOperation | AtlasBackupRetentionOperation;
    path: string;
    readPath: string;
    payload: Readonly<Record<string, unknown>> | undefined;
    requiresScheduleCapability: boolean;
    signal: AbortSignal;
  }>,
): Promise<AtlasBackupPolicyMutationResult> {
  const { targetId, signal } = input;
  client.assertMutationAllowed();

  const precheck = await describeBackupTargetSafely(client, targetId, signal);
  if (precheck.kind === "denied")
    throw new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (precheck.kind === "absent")
    throw new AtlasCliError(
      "backup_target_not_found",
      `Registered backup target not found: ${targetId}`,
    );
  if (
    input.requiresScheduleCapability &&
    precheck.kind === "described" &&
    !precheck.schedule
  )
    throw new AtlasCliError(
      "backup_operation_unsupported",
      `Registered backup target ${targetId} does not support scheduling`,
    );

  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.mutate(
      {
        descriptor: input.descriptor,
        path: input.path,
        ...(input.payload === undefined ? {} : { payload: input.payload }),
      },
      signal,
    );
  } catch (error) {
    throw mapMutationDispatchError(
      error,
      `backup policy request for ${targetId}`,
      `Re-read authoritative state with: atlas backups list`,
    );
  }

  if (envelope.status < 200 || envelope.status >= 300)
    throw mapBackupPolicyRejection(envelope, targetId);
  if (
    envelope.malformed ||
    typeof envelope.body !== "object" ||
    envelope.body === null
  )
    throw new AtlasCliError(
      "backup_operation_failed",
      "Atlas returned an unreadable backup policy response",
    );

  // Never claimed from the mutation response alone: the stored policy is read
  // back from the authoritative route.
  const authoritative = await readBackupPolicySafely(
    client,
    input.readPath,
    signal,
  );
  return Object.freeze({
    targetId,
    operation: input.operation,
    result: "completed" as const,
    // Explicitly null rather than absent, so the JSON envelope keeps one shape
    // whether or not the confirming read succeeded.
    policy: authoritative ?? null,
    authoritativeRead: authoritative === undefined ? "unavailable" : "ok",
  });
}

async function readBackupPolicySafely(
  client: AtlasAdministrativeClient,
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.readEnvelope(path, signal);
  } catch {
    return undefined;
  }
  if (
    envelope.status !== 200 ||
    envelope.malformed ||
    typeof envelope.body !== "object" ||
    envelope.body === null
  )
    return undefined;
  return envelope.body;
}

export type AtlasBackupRetentionPruneResult = Readonly<{
  targetId: string;
  operation: "prune";
  /** The server's own outcome word, never a rephrasing of it. */
  result: string;
  processedCount: number;
  deletedCount: number;
}>;

async function executeBackupRetentionPrune(
  client: AtlasAdministrativeClient,
  args: readonly string[],
  signal: AbortSignal,
): Promise<AtlasBackupRetentionPruneResult> {
  const targetId = requireBackupTargetIdArgument(args);
  client.assertMutationAllowed();

  const precheck = await describeBackupTargetSafely(client, targetId, signal);
  if (precheck.kind === "denied")
    throw new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (precheck.kind === "absent")
    throw new AtlasCliError(
      "backup_target_not_found",
      `Registered backup target not found: ${targetId}`,
    );

  let envelope: AtlasAdministrativeResponse;
  try {
    envelope = await client.mutate(
      {
        descriptor: backupRetentionMutation("prune"),
        path: backupRetentionPrunePath(targetId),
      },
      signal,
    );
  } catch (error) {
    throw mapMutationDispatchError(
      error,
      `retention prune request for ${targetId}`,
      `Re-read authoritative state with: atlas backups runs`,
    );
  }

  if (envelope.status < 200 || envelope.status >= 300)
    throw mapBackupPolicyRejection(envelope, targetId);
  const result = readRetentionResult(envelope);
  if (result === undefined)
    throw new AtlasCliError(
      "backup_operation_failed",
      "Atlas returned an unexpected retention prune response",
    );

  // Success is judged only by the server's own `result`, never by the HTTP
  // status: the prune route answers 200 for every outcome it can reach.
  if (result.result === "busy" || result.result === "blocked")
    // Genuinely ambiguous: the prune did not run to completion and the
    // operator cannot tell from here how much, if anything, was deleted.
    throw new AtlasCliError(
      "mutation_outcome_unknown",
      `Atlas reported the retention prune for ${targetId} as ${result.result}; it may have deleted some artifacts. Re-read authoritative state with: atlas backups runs`,
    );
  if (result.result !== "completed")
    // A partial prune is a known partial failure, not an ambiguity: the server
    // already reported exactly how much it processed and deleted.
    throw new AtlasCliError(
      "backup_operation_failed",
      `Atlas reported the retention prune for ${targetId} as ${result.result} after processing ${result.processedCount} and deleting ${result.deletedCount}`,
    );
  return Object.freeze({
    targetId,
    operation: "prune" as const,
    result: result.result,
    processedCount: result.processedCount,
    deletedCount: result.deletedCount,
  });
}

function readRetentionResult(
  envelope: AtlasAdministrativeResponse,
):
  | Readonly<{ result: string; processedCount: number; deletedCount: number }>
  | undefined {
  if (
    envelope.malformed ||
    typeof envelope.body !== "object" ||
    envelope.body === null
  )
    return undefined;
  const record = envelope.body as Record<string, unknown>;
  if (
    typeof record.result !== "string" ||
    typeof record.processedCount !== "number" ||
    typeof record.deletedCount !== "number"
  )
    return undefined;
  return Object.freeze({
    result: record.result,
    processedCount: record.processedCount,
    deletedCount: record.deletedCount,
  });
}

function mapBackupPolicyRejection(
  envelope: AtlasAdministrativeResponse,
  targetId: string,
): AtlasCliError {
  if (envelope.status === 401 || envelope.status === 403)
    return new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  if (envelope.status === 404)
    return new AtlasCliError(
      "backup_target_not_found",
      `Registered backup target not found: ${targetId}`,
    );
  if (envelope.status === 409 || envelope.status === 429)
    return new AtlasCliError(
      "operation_conflict",
      envelope.status === 429
        ? "Atlas is rate limiting administrative requests; retry shortly"
        : "Another backup operation is in progress",
    );
  // The operator's policy was rejected. Retrying it unchanged can never help,
  // so this must not be reported as a transient infrastructure problem.
  if (
    envelope.status === 400 &&
    envelope.errorCode === "invalid_backup_request"
  )
    return new AtlasCliError(
      "schedule_invalid",
      "Atlas rejected the backup policy as invalid",
    );
  return new AtlasCliError(
    "backup_operation_failed",
    `Atlas rejected the backup operation (HTTP ${envelope.status}${
      envelope.errorCode === undefined ? "" : `, ${envelope.errorCode}`
    })`,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function readOverviewField(
  client: AtlasAdministrativeClient,
  field: "backups" | "machinePlan" | "powerSafety" | "machineSchedule",
  signal: AbortSignal,
): Promise<unknown> {
  const overview = await client.read("/admin/overview", signal);
  if (typeof overview !== "object" || overview === null) return null;
  return (overview as Record<string, unknown>)[field] ?? null;
}

type PreviewOptions = Readonly<{
  startsAt: string;
  endsAt: string;
  /** Serialized candidate policy for the draft preview, when requested. */
  candidatePolicy: string | undefined;
}>;

function readPreviewOptions(args: readonly string[]): PreviewOptions {
  const interval = { startsAt: "", endsAt: "" };
  let candidatePolicy: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new AtlasCliError(
        "invalid_arguments",
        `Option ${String(flag)} requires a value`,
      );
    if (flag === "--from") interval.startsAt = value;
    else if (flag === "--to") interval.endsAt = value;
    else if (flag === "--policy") candidatePolicy = value;
    else
      throw new AtlasCliError(
        "invalid_arguments",
        `Unknown option: ${String(flag)}`,
      );
    index += 1;
  }
  if (
    (interval.startsAt === "") !== (interval.endsAt === "") ||
    (interval.startsAt === "" && candidatePolicy !== undefined)
  )
    throw new AtlasCliError(
      "invalid_arguments",
      "Preview options require --from <timestamp> --to <timestamp>",
    );
  if (interval.startsAt === "") {
    const starts = new Date();
    starts.setUTCSeconds(0, 0);
    return Object.freeze({
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      candidatePolicy: undefined,
    });
  }
  return Object.freeze({ ...interval, candidatePolicy });
}

async function readHealth(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
): Promise<unknown> {
  const [live, server] = await Promise.all([
    client.read("/health/live", signal),
    client.read("/health/server", signal),
  ]);
  return Object.freeze({ endpoint: client.endpoint, live, server });
}

async function readStatus(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
): Promise<unknown> {
  const health = await readHealth(client, signal);
  let administrative: unknown;
  try {
    administrative = await client.read("/admin/overview", signal);
  } catch (error) {
    if (
      error instanceof AtlasCliError &&
      error.code === "administrative_access_denied"
    ) {
      administrative = Object.freeze({ status: "authentication_required" });
    } else {
      throw error;
    }
  }
  const infrastructure = await readOptionalDiagnostics(client, signal);
  return Object.freeze({
    atlasManager: Object.freeze({ endpoint: client.endpoint, health }),
    administrative,
    // Additive: nothing above is removed or renamed.
    infrastructure,
  });
}

/**
 * The four legacy checks keep their exact `{name, status, code?}` shape. The
 * infrastructure checks are *appended* as further entries and the new optional
 * fields sit alongside the old ones, so a consumer that only reads `name` and
 * `status` is unaffected.
 */
async function readDoctor(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
): Promise<unknown> {
  const checks: Array<Record<string, unknown>> = [];
  for (const [name, path] of [
    ["atlas_health_live", "/health/live"],
    ["atlas_health_server", "/health/server"],
    ["administrative_overview", "/admin/overview"],
    ["administrative_security_posture", "/admin/security/status"],
  ] as const) {
    try {
      await client.read(path, signal);
      checks.push({ name, status: "pass" });
    } catch (error) {
      checks.push({
        name,
        status: "fail",
        code:
          error instanceof AtlasCliError
            ? error.code
            : "infrastructure_unavailable",
      });
    }
  }
  const infrastructure = await readOptionalDiagnostics(client, signal);
  for (const check of infrastructure.checks)
    checks.push({
      name: check.id,
      // "disabled" is not a failure, even in the legacy pass/fail vocabulary:
      // an intentionally-off capability must never read as broken.
      status:
        check.status === "ok" || check.status === "disabled" ? "pass" : "fail",
      ...(check.errorCode === undefined ? {} : { code: check.errorCode }),
      id: check.id,
      diagnosticStatus: check.status,
      observedAt: check.observedAt,
      ...(check.observed === undefined ? {} : { observed: check.observed }),
      ...(check.expected === undefined ? {} : { expected: check.expected }),
      ...(check.hint === undefined ? {} : { hint: check.hint }),
      ...(check.requiresPrivilege === undefined
        ? {}
        : { requiresPrivilege: check.requiresPrivilege }),
    });
  const failed = checks.filter((check) => check.status === "fail");
  return Object.freeze({
    endpoint: client.endpoint,
    status: failed.length === 0 ? "pass" : "partial",
    infrastructureStatus: infrastructure.overallStatus,
    checks: Object.freeze(checks),
  });
}

// ---------------------------------------------------------------------------
// Infrastructure diagnostics (ADR-032)
//
// Every diagnostic reaches the CLI over the authenticated administrative API.
// The CLI never inspects a host itself — not remotely and not when it happens
// to run on the Atlas host — which `tests/cli/no-direct-host-mutation.test.ts`
// enforces structurally. These are reads only: there is no repair command, and
// adding one would require its own route with a real mutation gate.
// ---------------------------------------------------------------------------

export type AtlasDiagnosticCheck = Readonly<{
  id: string;
  status: AtlasDiagnosticStatus;
  observed?: string;
  expected?: string;
  errorCode?: string;
  hint?: string;
  requiresPrivilege?: boolean;
  observedAt: string;
}>;

export type AtlasDiagnosticReport = Readonly<{
  generatedAt: string;
  overallStatus: AtlasDiagnosticStatus;
  checks: readonly AtlasDiagnosticCheck[];
}>;

/** The single HTTP call every diagnostics command shares. */
async function readInfrastructureDiagnostics(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
): Promise<AtlasDiagnosticReport> {
  const body = await client.read(ATLAS_INFRASTRUCTURE_DIAGNOSTICS_PATH, signal);
  const report = parseDiagnosticReport(body);
  if (report === undefined)
    throw new AtlasCliError(
      "infrastructure_unavailable",
      "Atlas returned an unrecognized diagnostics report",
    );
  return report;
}

function parseDiagnosticReport(
  body: unknown,
): AtlasDiagnosticReport | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (
    typeof record.generatedAt !== "string" ||
    !isDiagnosticStatus(record.overallStatus) ||
    !Array.isArray(record.checks)
  )
    return undefined;
  const checks: AtlasDiagnosticCheck[] = [];
  for (const entry of record.checks) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const check = entry as Record<string, unknown>;
    if (
      typeof check.id !== "string" ||
      !isDiagnosticStatus(check.status) ||
      typeof check.observedAt !== "string"
    )
      return undefined;
    checks.push(check as unknown as AtlasDiagnosticCheck);
  }
  return Object.freeze({
    generatedAt: record.generatedAt,
    overallStatus: record.overallStatus,
    checks: Object.freeze(checks),
  });
}

function isDiagnosticStatus(value: unknown): value is AtlasDiagnosticStatus {
  return (
    value === "ok" ||
    value === "degraded" ||
    value === "down" ||
    value === "disabled" ||
    value === "unavailable"
  );
}

async function readInfraStatus(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
): Promise<unknown> {
  const report = await readInfrastructureDiagnostics(client, signal);
  return Object.freeze({ endpoint: client.endpoint, ...report });
}

/**
 * A command-specific view over the one report, selected by check-id prefix.
 *
 * The subset carries its own `overallStatus` so `atlas nginx test` is not
 * judged by a cloudflared outage it never asked about. The precedence used is
 * the CLI's pinned copy of the server's, held honest by the contract test.
 */
async function readDiagnosticSubset(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
  matches: (id: string) => boolean,
): Promise<unknown> {
  const report = await readInfrastructureDiagnostics(client, signal);
  const checks = report.checks.filter((check) => matches(check.id));
  return Object.freeze({
    endpoint: client.endpoint,
    generatedAt: report.generatedAt,
    overallStatus: atlasDiagnosticOverallStatus(checks),
    checks: Object.freeze(checks),
  });
}

/**
 * Diagnostics for `status` and `doctor`.
 *
 * These two commands must keep working on a deployment that never enabled the
 * diagnostics capability, so a refusal or an unreachable route degrades to
 * `disabled` — calm, exit 0 — rather than reporting an outage that is really
 * just an unset feature flag. The five dedicated diagnostics commands make the
 * opposite trade: you asked for diagnostics and did not get them, so that is a
 * partial failure.
 */
async function readOptionalDiagnostics(
  client: AtlasAdministrativeClient,
  signal: AbortSignal,
): Promise<AtlasDiagnosticReport> {
  try {
    return await readInfrastructureDiagnostics(client, signal);
  } catch (error) {
    if (error instanceof AtlasCliInterruptedError) throw error;
    return Object.freeze({
      generatedAt: new Date(0).toISOString(),
      overallStatus: "disabled" as const,
      checks: Object.freeze([]),
    });
  }
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

function requireArgument(args: readonly string[], name: string): string {
  const value = args[0];
  if (value === undefined || value.length === 0) {
    throw new AtlasCliError("invalid_arguments", `${name} is required`);
  }
  return value;
}

/** A single positional argument with no options of any kind. */
function requireSingleArgument(args: readonly string[], name: string): string {
  const value = args[0];
  if (value === undefined || value.length === 0)
    throw new AtlasCliError("invalid_arguments", `${name} is required`);
  if (value.startsWith("-"))
    throw new AtlasCliError("invalid_arguments", `Unknown option: ${value}`);
  if (args.length > 1)
    throw new AtlasCliError(
      "invalid_arguments",
      `Unexpected argument: ${String(args[1])}`,
    );
  return value;
}

/**
 * A backup target is a *registered target id* and nothing else. There is
 * deliberately no source or destination option: a backup may only ever read
 * and write the locations its registered target declares, under the limits
 * that target carries.
 */
function requireBackupTargetIdArgument(args: readonly string[]): string {
  const value = requireSingleArgument(args, "backup target id");
  if (!isAtlasBackupTargetId(value))
    throw new AtlasCliError(
      "invalid_arguments",
      `Invalid backup target id: ${value}`,
    );
  return value;
}

/**
 * `<target-id> --policy '<json>'` for backup schedule and retention writes.
 *
 * As with service schedules, the JSON is parsed only so a typo fails as a
 * usage error before a request is spent. Its content is never inspected here.
 */
function readBackupPolicyArguments(args: readonly string[]): Readonly<{
  targetId: string;
  policy: unknown;
}> {
  const targetId = args[0];
  if (targetId === undefined || targetId.length === 0)
    throw new AtlasCliError(
      "invalid_arguments",
      "backup target id is required",
    );
  if (targetId.startsWith("-"))
    throw new AtlasCliError("invalid_arguments", `Unknown option: ${targetId}`);
  if (!isAtlasBackupTargetId(targetId))
    throw new AtlasCliError(
      "invalid_arguments",
      `Invalid backup target id: ${targetId}`,
    );
  const rest = args.slice(1);
  if (rest.length !== 2 || rest[0] !== "--policy")
    throw new AtlasCliError(
      "invalid_arguments",
      rest.length > 0 && rest[0] !== "--policy" && rest[0]?.startsWith("-")
        ? `Unknown option: ${String(rest[0])}`
        : "Option --policy <json> is required",
    );
  try {
    return Object.freeze({
      targetId,
      policy: JSON.parse(rest[1] as string) as unknown,
    });
  } catch {
    throw new AtlasCliError(
      "invalid_arguments",
      "Option --policy requires valid JSON",
    );
  }
}

/**
 * `schedule set <serviceId> --policy '<json>'`.
 *
 * The JSON is parsed here only so that a typo fails as a usage error before a
 * request is spent. Its *content* is never inspected: the server's schedule
 * domain decides what a valid policy is.
 */
function readSchedulePolicyArguments(args: readonly string[]): Readonly<{
  serviceId: string;
  policy: unknown;
}> {
  const serviceId = args[0];
  if (serviceId === undefined || serviceId.length === 0)
    throw new AtlasCliError("invalid_arguments", "service id is required");
  if (serviceId.startsWith("-"))
    throw new AtlasCliError(
      "invalid_arguments",
      `Unknown option: ${serviceId}`,
    );
  if (!isAtlasServiceId(serviceId))
    throw new AtlasCliError(
      "invalid_arguments",
      `Invalid service id: ${serviceId}`,
    );
  const rest = args.slice(1);
  if (rest.length !== 2 || rest[0] !== "--policy")
    throw new AtlasCliError(
      "invalid_arguments",
      rest.length > 0 && rest[0] !== "--policy" && rest[0]?.startsWith("-")
        ? `Unknown option: ${String(rest[0])}`
        : "Option --policy <json> is required",
    );
  try {
    return Object.freeze({
      serviceId,
      policy: JSON.parse(rest[1] as string) as unknown,
    });
  } catch {
    throw new AtlasCliError(
      "invalid_arguments",
      "Option --policy requires valid JSON",
    );
  }
}

/**
 * A mutation target is a *registered service id* and nothing else. There is
 * deliberately no `--pm2`, `--container` or `--unit` escape hatch: accepting
 * one would let an operator address a runtime object the application does not
 * know about, outside its authorization and audit model (ADR-028).
 */
function requireServiceIdArgument(args: readonly string[]): string {
  const value = args[0];
  if (value === undefined || value.length === 0)
    throw new AtlasCliError("invalid_arguments", "service id is required");
  if (value.startsWith("-"))
    throw new AtlasCliError("invalid_arguments", `Unknown option: ${value}`);
  if (args.length > 1)
    throw new AtlasCliError(
      "invalid_arguments",
      `Unexpected argument: ${String(args[1])}`,
    );
  if (!isAtlasServiceId(value))
    throw new AtlasCliError(
      "invalid_arguments",
      `Invalid service id: ${value}`,
    );
  return value;
}
