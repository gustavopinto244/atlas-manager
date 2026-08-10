import {
  AtlasCliInterruptedError,
  AtlasCliNetworkError,
  AtlasCliTimeoutError,
  createAtlasAdministrativeClient,
  type AtlasAdministrativeClient,
  type AtlasAdministrativeResponse,
} from "./administrative-client.js";
import {
  isAtlasServiceId,
  serviceActionMutation,
  serviceActionPath,
  serviceReadPath,
  type AtlasServiceOperation,
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
}

export function createAtlasHttpTransport(
  options: AtlasHttpTransportOptions = {},
): AtlasCliTransport {
  const client = createAtlasAdministrativeClient(options);
  return Object.freeze({
    execute: (command: string, args: readonly string[], signal: AbortSignal) =>
      executeHttpCommand(client, command, args, signal),
  });
}

async function executeHttpCommand(
  client: AtlasAdministrativeClient,
  command: string,
  args: readonly string[],
  signal: AbortSignal,
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
    case "backups list":
      return client.read("/admin/backups/targets", signal);
    case "backups status":
      return readOverviewField(client, "backups", signal);
    case "backups runs":
      return client.read("/admin/backups/runs?limit=50", signal);
    case "events": {
      const limit = args.includes("--tail") ? 100 : 20;
      return client.read(`/admin/event-history?limit=${limit}`, signal);
    }
    case "machine plan":
      return readOverviewField(client, "machinePlan", signal);
    case "machine status":
      return readOverviewField(client, "powerSafety", signal);
    case "machine schedule show":
      return readOverviewField(client, "machineSchedule", signal);
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
    throw mapMutationDispatchError(error, operation, serviceId);
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

function mapMutationDispatchError(
  error: unknown,
  operation: AtlasServiceOperation,
  serviceId: string,
): Error {
  const recheck = `Re-read authoritative state with: atlas services status ${serviceId}`;
  if (error instanceof AtlasCliInterruptedError)
    return new AtlasCliError(
      "mutation_interrupted_outcome_unknown",
      `Interrupted after the ${operation} request for ${serviceId} may have been sent. ${recheck}`,
    );
  if (error instanceof AtlasCliTimeoutError)
    return new AtlasCliError(
      "mutation_outcome_unknown",
      `The ${operation} request for ${serviceId} timed out and may still have been applied. ${recheck}`,
    );
  if (error instanceof AtlasCliNetworkError)
    return error.undelivered
      ? new AtlasCliError(
          "infrastructure_unavailable",
          "Atlas endpoint unavailable; the operation was not delivered",
        )
      : new AtlasCliError(
          "mutation_outcome_unknown",
          `The ${operation} request for ${serviceId} failed in transit and may still have been applied. ${recheck}`,
        );
  if (error instanceof AtlasCliError) return error;
  return new AtlasCliError(
    "mutation_outcome_unknown",
    `The ${operation} request for ${serviceId} did not complete and may still have been applied. ${recheck}`,
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
  return Object.freeze({
    atlasManager: Object.freeze({ endpoint: client.endpoint, health }),
    administrative,
  });
}

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
  const failed = checks.filter((check) => check.status === "fail");
  return Object.freeze({
    endpoint: client.endpoint,
    status: failed.length === 0 ? "pass" : "partial",
    checks: Object.freeze(checks),
  });
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
