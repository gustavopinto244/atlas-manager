import { CHECK_ID, type DiagnosticCheckId } from "../domain/check-ids.js";
import {
  createDiagnosticCheck,
  type DiagnosticCheck,
} from "../domain/diagnostic-check.js";
import {
  createDiagnosticReport,
  type DiagnosticReport,
} from "../domain/diagnostic-report.js";
import type { DiagnosticStatus } from "../domain/diagnostic-status.js";
import type {
  DiagnosticUnitName,
  SystemdUnitStateReader,
} from "../ports/systemd-unit-state-reader.js";
import type { NginxConfigTestRunner } from "../ports/nginx-config-test-runner.js";
import type {
  TcpListenerBinding,
  TcpListenerReader,
} from "../ports/tcp-listener-reader.js";

export type DiagnosticClock = Readonly<{ now(): Date }>;

export type ExpectedListener = Readonly<{
  port: number;
  binding: TcpListenerBinding;
}>;

/**
 * Every source the report can draw on. All of them are optional: a source that
 * is not composed means the operator did not enable that capability, so its
 * check reports `disabled` rather than `down`. Reporting an unconfigured
 * scheduler as an outage would train operators to ignore the report.
 */
export interface InfrastructureDiagnosticSources {
  readonly clock: DiagnosticClock;
  readonly systemdUnitStateReader?: SystemdUnitStateReader;
  readonly tcpListenerReader?: TcpListenerReader;
  readonly nginxConfigTestRunner?: NginxConfigTestRunner;
  readonly expectedListener?: ExpectedListener;
  readonly serverHealthReader?: Readonly<{ execute(): Promise<unknown> }>;
  readonly pm2ProcessListExecutor?: Readonly<{ execute(): Promise<string> }>;
  readonly backupSchedulerCursorReader?: Readonly<{
    read(): Promise<unknown>;
  }>;
  readonly powerSchedulerCursorReader?: Readonly<{ read(): Promise<unknown> }>;
  readonly serviceAvailabilityReconciliationSchedulerCursorReader?: Readonly<{
    read(): Promise<unknown>;
  }>;
  readonly eventHistoryReadinessReader?: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly powerPostureReader?: Readonly<{
    execute(): Readonly<Record<string, unknown>>;
  }>;
}

/** Above these, the host is reported as degraded rather than healthy. */
const MEMORY_DEGRADED_PERCENT = 95;
const DISK_DEGRADED_PERCENT = 90;

/**
 * Build the whole report.
 *
 * Two obligations dominate the shape of this function (ADR-032 §5):
 *
 * 1. **No check may cancel another.** Every probe is invoked through `probe()`
 *    as a *thunk*, so a source that throws synchronously — not only one that
 *    rejects — still becomes an `unavailable` check instead of destroying the
 *    report. Calling the probes eagerly to build an array literal would let the
 *    first synchronous throw escape before `Promise.allSettled` ever saw the
 *    array, and would strand the already-created promises as unhandled
 *    rejections.
 * 2. **Order must not depend on timing.** Probes run concurrently, and the
 *    results are then sorted back into the `CHECK_ORDER` constant by
 *    `createDiagnosticReport`.
 */
export async function buildInfrastructureDiagnosticReport(
  sources: InfrastructureDiagnosticSources,
): Promise<DiagnosticReport> {
  const observedAt = sources.clock.now().toISOString();
  const checks = await Promise.all([
    probe(CHECK_ID.atlasService, observedAt, () =>
      unitCheck(sources, CHECK_ID.atlasService, "atlas-manager", observedAt),
    ),
    probe(CHECK_ID.atlasHealthLive, observedAt, () =>
      Promise.resolve(atlasHealthLiveCheck(observedAt)),
    ),
    probe(CHECK_ID.atlasHealthServer, observedAt, () =>
      atlasHealthServerCheck(sources, observedAt),
    ),
    probe(CHECK_ID.pm2Process, observedAt, () => pm2Check(sources, observedAt)),
    probe(CHECK_ID.listenerAtlas, observedAt, () =>
      listenerCheck(sources, observedAt),
    ),
    probe(CHECK_ID.schedulerBackup, observedAt, () =>
      schedulerCheck(
        CHECK_ID.schedulerBackup,
        sources.backupSchedulerCursorReader,
        observedAt,
      ),
    ),
    probe(CHECK_ID.schedulerPower, observedAt, () =>
      schedulerCheck(
        CHECK_ID.schedulerPower,
        sources.powerSchedulerCursorReader,
        observedAt,
      ),
    ),
    probe(CHECK_ID.schedulerServiceAvailability, observedAt, () =>
      schedulerCheck(
        CHECK_ID.schedulerServiceAvailability,
        sources.serviceAvailabilityReconciliationSchedulerCursorReader,
        observedAt,
      ),
    ),
    probe(CHECK_ID.eventHistoryReadiness, observedAt, () =>
      eventHistoryCheck(sources, observedAt),
    ),
    probe(CHECK_ID.powerPosture, observedAt, () =>
      Promise.resolve(powerPostureCheck(sources, observedAt)),
    ),
    probe(CHECK_ID.nginxService, observedAt, () =>
      unitCheck(sources, CHECK_ID.nginxService, "nginx", observedAt),
    ),
    probe(CHECK_ID.nginxConfig, observedAt, () =>
      nginxConfigCheck(sources, observedAt),
    ),
    probe(CHECK_ID.tunnelCloudflaredService, observedAt, () =>
      unitCheck(
        sources,
        CHECK_ID.tunnelCloudflaredService,
        "cloudflared",
        observedAt,
      ),
    ),
  ]);
  return createDiagnosticReport(observedAt, checks);
}

/**
 * The containment boundary for one check. Nothing that happens inside a source
 * — a rejection, a synchronous throw, a bug in an adapter — is allowed past
 * this point.
 */
async function probe(
  id: DiagnosticCheckId,
  observedAt: string,
  run: () => Promise<DiagnosticCheck>,
): Promise<DiagnosticCheck> {
  try {
    return await run();
  } catch {
    return createDiagnosticCheck({
      id,
      status: "unavailable",
      observedAt,
      errorCode: "diagnostic_probe_failed",
      hint: "The diagnostic could not be completed.",
    });
  }
}

async function unitCheck(
  sources: InfrastructureDiagnosticSources,
  id: DiagnosticCheckId,
  unitName: DiagnosticUnitName,
  observedAt: string,
): Promise<DiagnosticCheck> {
  const reader = sources.systemdUnitStateReader;
  if (reader === undefined) return notComposed(id, observedAt);
  const outcome = await reader.read(unitName);
  if (outcome.outcome === "undetermined")
    return createDiagnosticCheck({
      id,
      status: "unavailable",
      observedAt,
      expected: "active",
      errorCode: outcome.code,
      ...(outcome.requiresPrivilege
        ? {
            requiresPrivilege: true,
            hint: "Atlas lacks the privilege to read this unit. It is never elevated automatically.",
          }
        : {}),
    });
  return createDiagnosticCheck({
    id,
    status: unitStatus(outcome.activeState, outcome.unitFileState),
    observedAt,
    observed: `${outcome.activeState}/${outcome.subState}`,
    expected: "active",
    hint: `unit file ${outcome.unitFileState}`,
  });
}

/**
 * `disabled` and `masked` are checked first on purpose: a unit the operator
 * deliberately turned off is not an outage, even though its ActiveState reads
 * `inactive`.
 */
function unitStatus(
  activeState: string,
  unitFileState: string,
): DiagnosticStatus {
  if (unitFileState === "disabled" || unitFileState === "masked")
    return "disabled";
  if (activeState === "active") return "ok";
  if (activeState === "activating" || activeState === "reloading")
    return "degraded";
  if (activeState === "failed" || activeState === "inactive") return "down";
  return "unavailable";
}

/**
 * The diagnostics run inside the live server process, so this check answering
 * at all is the evidence that the process is up. It exists so the report's
 * shape matches `doctor`'s vocabulary, not because it can meaningfully fail.
 */
function atlasHealthLiveCheck(observedAt: string): DiagnosticCheck {
  return createDiagnosticCheck({
    id: CHECK_ID.atlasHealthLive,
    status: "ok",
    observedAt,
    observed: "process responding",
    expected: "process responding",
  });
}

async function atlasHealthServerCheck(
  sources: InfrastructureDiagnosticSources,
  observedAt: string,
): Promise<DiagnosticCheck> {
  const reader = sources.serverHealthReader;
  if (reader === undefined)
    return notComposed(CHECK_ID.atlasHealthServer, observedAt);
  let snapshot: unknown;
  try {
    snapshot = await reader.execute();
  } catch {
    return createDiagnosticCheck({
      id: CHECK_ID.atlasHealthServer,
      status: "unavailable",
      observedAt,
      errorCode: "server_health_unreadable",
    });
  }
  const memory = numberField(snapshot, "memoryUsagePercent");
  const disk = numberField(snapshot, "diskUsagePercent");
  if (memory === undefined || disk === undefined)
    return createDiagnosticCheck({
      id: CHECK_ID.atlasHealthServer,
      status: "unavailable",
      observedAt,
      errorCode: "server_health_output_invalid",
    });
  const degraded =
    memory >= MEMORY_DEGRADED_PERCENT || disk >= DISK_DEGRADED_PERCENT;
  return createDiagnosticCheck({
    id: CHECK_ID.atlasHealthServer,
    status: degraded ? "degraded" : "ok",
    observedAt,
    observed: `memory ${Math.round(memory)}% · disk ${Math.round(disk)}%`,
    expected: `memory below ${MEMORY_DEGRADED_PERCENT}% · disk below ${DISK_DEGRADED_PERCENT}%`,
  });
}

async function pm2Check(
  sources: InfrastructureDiagnosticSources,
  observedAt: string,
): Promise<DiagnosticCheck> {
  const executor = sources.pm2ProcessListExecutor;
  if (executor === undefined)
    return notComposed(CHECK_ID.pm2Process, observedAt);
  let output: string;
  try {
    output = await executor.execute();
  } catch {
    return createDiagnosticCheck({
      id: CHECK_ID.pm2Process,
      status: "unavailable",
      observedAt,
      errorCode: "pm2_unreadable",
      hint: "The PM2 process list could not be read.",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed))
    return createDiagnosticCheck({
      id: CHECK_ID.pm2Process,
      status: "unavailable",
      observedAt,
      errorCode: "pm2_output_invalid",
    });
  // Process names are deliberately not emitted: the count is the diagnostic,
  // and a name list would leak the shape of an operator's private deployment
  // to anyone holding only the diagnostics permission.
  const online = parsed.filter(
    (entry) => readPm2Status(entry) === "online",
  ).length;
  return createDiagnosticCheck({
    id: CHECK_ID.pm2Process,
    status: "ok",
    observedAt,
    observed: `daemon reachable · ${online} of ${parsed.length} online`,
    expected: "daemon reachable",
  });
}

function readPm2Status(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const environment = (entry as { pm2_env?: unknown }).pm2_env;
  if (typeof environment !== "object" || environment === null) return undefined;
  const status = (environment as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

async function listenerCheck(
  sources: InfrastructureDiagnosticSources,
  observedAt: string,
): Promise<DiagnosticCheck> {
  const reader = sources.tcpListenerReader;
  const expected = sources.expectedListener;
  if (reader === undefined || expected === undefined)
    return notComposed(CHECK_ID.listenerAtlas, observedAt);
  const expectation = `${expected.binding} :${expected.port}`;
  const outcome = await reader.read();
  if (outcome.outcome === "undetermined")
    return createDiagnosticCheck({
      id: CHECK_ID.listenerAtlas,
      status: "unavailable",
      observedAt,
      expected: expectation,
      errorCode: outcome.code,
      ...(outcome.requiresPrivilege
        ? {
            requiresPrivilege: true,
            hint: "Atlas lacks the privilege to enumerate listeners. It is never elevated automatically.",
          }
        : {}),
    });
  const matching = outcome.listeners.filter(
    (listener) => listener.port === expected.port,
  );
  if (matching.length === 0)
    return createDiagnosticCheck({
      id: CHECK_ID.listenerAtlas,
      status: "down",
      observedAt,
      observed: "not listening",
      expected: expectation,
    });
  const bindings = [
    ...new Set(matching.map((listener) => listener.binding)),
  ].sort();
  const observed = `${bindings.join("+")} :${expected.port}`;
  // A wildcard bind where loopback was expected is a real exposure change, but
  // the port *is* being served — degraded, not down.
  const widened =
    expected.binding === "loopback" && bindings.includes("wildcard");
  return createDiagnosticCheck({
    id: CHECK_ID.listenerAtlas,
    status: widened ? "degraded" : "ok",
    observedAt,
    observed,
    expected: expectation,
    // Owner resolution needs elevated /proc/<pid>/fd access. Its absence is
    // never allowed to fail the check (ADR-032 §8).
    hint: "owner unresolved",
  });
}

async function schedulerCheck(
  id: DiagnosticCheckId,
  reader: Readonly<{ read(): Promise<unknown> }> | undefined,
  observedAt: string,
): Promise<DiagnosticCheck> {
  if (reader === undefined) return notComposed(id, observedAt);
  let cursor: unknown;
  try {
    cursor = await reader.read();
  } catch {
    return createDiagnosticCheck({
      id,
      status: "unavailable",
      observedAt,
      errorCode: "scheduler_cursor_unreadable",
    });
  }
  const lastTick = readLastTick(cursor);
  return createDiagnosticCheck({
    id,
    status: "ok",
    observedAt,
    observed:
      lastTick === undefined ? "no tick recorded yet" : `last tick ${lastTick}`,
    expected: "cursor readable",
  });
}

/**
 * Last-tick *evidence*, read from the persisted cursor. There is no live-loop
 * instrumentation in this system and this milestone does not add any, so the
 * absence of a recorded tick is reported as a fact rather than judged.
 */
function readLastTick(cursor: unknown): string | undefined {
  if (typeof cursor === "string") return cursor;
  if (typeof cursor !== "object" || cursor === null) return undefined;
  for (const key of [
    "lastTickAt",
    "observedAt",
    "occurredAt",
    "completedThrough",
    "value",
  ]) {
    const value = (cursor as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

async function eventHistoryCheck(
  sources: InfrastructureDiagnosticSources,
  observedAt: string,
): Promise<DiagnosticCheck> {
  const reader = sources.eventHistoryReadinessReader;
  if (reader === undefined)
    return notComposed(CHECK_ID.eventHistoryReadiness, observedAt);
  let result: unknown;
  try {
    result = await reader.execute();
  } catch {
    return createDiagnosticCheck({
      id: CHECK_ID.eventHistoryReadiness,
      status: "unavailable",
      observedAt,
      errorCode: "event_history_readiness_unreadable",
    });
  }
  const outcome = stringField(result, "outcome");
  if (outcome === "ready")
    return createDiagnosticCheck({
      id: CHECK_ID.eventHistoryReadiness,
      status: "ok",
      observedAt,
      observed: "ready",
      expected: "ready",
    });
  // An unwritable or corrupted audit trail is a genuine outage: administrative
  // mutations refuse to proceed without one.
  return createDiagnosticCheck({
    id: CHECK_ID.eventHistoryReadiness,
    status: "down",
    observedAt,
    observed: outcome ?? "unknown",
    expected: "ready",
    ...(stringField(result, "code") === undefined
      ? {}
      : { errorCode: stringField(result, "code")! }),
  });
}

function powerPostureCheck(
  sources: InfrastructureDiagnosticSources,
  observedAt: string,
): DiagnosticCheck {
  const reader = sources.powerPostureReader;
  if (reader === undefined)
    return notComposed(CHECK_ID.powerPosture, observedAt);
  const posture = reader.execute();
  const effects = stringField(posture, "effects") ?? "disabled";
  const backend = stringField(posture, "backend") ?? "unknown";
  // Power effects switched off is the documented safe posture, not a fault.
  // It must read as calm in every layer (ADR-032 §6).
  return createDiagnosticCheck({
    id: CHECK_ID.powerPosture,
    status: effects === "disabled" ? "disabled" : "ok",
    observedAt,
    observed: `backend ${backend} · effects ${effects}`,
    expected: "an intentional power posture",
  });
}

async function nginxConfigCheck(
  sources: InfrastructureDiagnosticSources,
  observedAt: string,
): Promise<DiagnosticCheck> {
  const runner = sources.nginxConfigTestRunner;
  if (runner === undefined)
    return notComposed(CHECK_ID.nginxConfig, observedAt);
  const outcome = await runner.run();
  if (outcome.outcome === "valid")
    return createDiagnosticCheck({
      id: CHECK_ID.nginxConfig,
      status: "ok",
      observedAt,
      observed: "configuration test successful",
      expected: "configuration test successful",
      hint: "Syntax only. This does not verify that requests reach Atlas.",
    });
  if (outcome.outcome === "invalid")
    return createDiagnosticCheck({
      id: CHECK_ID.nginxConfig,
      status: "down",
      observedAt,
      observed: outcome.detail,
      expected: "configuration test successful",
      hint: "Syntax only. This does not verify that requests reach Atlas.",
    });
  return createDiagnosticCheck({
    id: CHECK_ID.nginxConfig,
    status: "unavailable",
    observedAt,
    expected: "configuration test successful",
    errorCode: outcome.code,
    ...(outcome.requiresPrivilege
      ? {
          requiresPrivilege: true,
          hint: "Atlas lacks the privilege to test the Nginx configuration. It is never elevated automatically.",
        }
      : {}),
  });
}

/**
 * A source the operator never composed. Reported as `disabled` — an intentional
 * configuration, excluded from `overallStatus` precedence entirely — and never
 * as `down`.
 */
function notComposed(
  id: DiagnosticCheckId,
  observedAt: string,
): DiagnosticCheck {
  return createDiagnosticCheck({
    id,
    status: "disabled",
    observedAt,
    observed: "not configured",
    hint: "This diagnostic source is not composed in this deployment.",
  });
}

function numberField(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" && Number.isFinite(field)
    ? field
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}
