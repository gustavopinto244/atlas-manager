/**
 * Exit-code policy for the read-only diagnostics commands (ADR-032 §10).
 *
 * The rule that shapes this module: **the report is always printed first, and
 * the exit code is derived from what was printed.** A diagnostic that aborts
 * before rendering is useless exactly when it matters, so nothing here throws
 * mid-collection — the transport completes every check, `main.ts` writes the
 * body, and only then does this decide the process's exit code.
 *
 * The status itself is never recomputed here. It is read from the payload the
 * server already derived with the one shared precedence algorithm.
 */

/** Commands whose exit code reflects an infrastructure diagnosis. */
const DIAGNOSTIC_COMMANDS: ReadonlySet<string> = new Set([
  "status",
  "doctor",
  "infra status",
  "infra listeners",
  "nginx status",
  "nginx test",
  "tunnel status",
]);

export function isDiagnosticCommand(command: string): boolean {
  return DIAGNOSTIC_COMMANDS.has(command);
}

/**
 * `down` and `unavailable` are partial failures. `degraded` stays a success
 * with a printed warning, and `disabled` is always a success — an operator who
 * intentionally turned a capability off must not get a failing exit code for
 * it.
 */
export function diagnosticOutcome(
  command: string,
  data: unknown,
): "failure" | "warning" | "ok" {
  if (!isDiagnosticCommand(command)) return "ok";
  const status = readOverallStatus(command, data);
  if (status === "down" || status === "unavailable") return "failure";
  if (status === "degraded") return "warning";
  return "ok";
}

function readOverallStatus(command: string, data: unknown): string | undefined {
  const record = asRecord(data);
  if (record === undefined) return undefined;
  // `status` nests the report; `doctor` carries the derived status alongside
  // its own legacy pass/partial field, which keeps its old meaning.
  if (command === "status")
    return stringField(asRecord(record.infrastructure), "overallStatus");
  if (command === "doctor") return stringField(record, "infrastructureStatus");
  return stringField(record, "overallStatus");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}
