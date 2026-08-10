/**
 * The five-value diagnostic vocabulary (ADR-032 §6).
 *
 * The distinctions that matter, and that the rest of the system depends on:
 *
 * - `down` — the thing is supposed to be working and is not.
 * - `unavailable` — the diagnostic itself could not be determined (permission
 *   denied, binary missing, timeout). This is *not* the same as `down`, and
 *   presenting it as an outage would send an operator chasing a failure that
 *   may not exist.
 * - `disabled` — the capability is intentionally off. It must never make the
 *   report look unhealthy, in any layer, in any vocabulary.
 */
export const DIAGNOSTIC_STATUSES = Object.freeze([
  "ok",
  "degraded",
  "down",
  "disabled",
  "unavailable",
] as const);

export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number];

export function isDiagnosticStatus(value: unknown): value is DiagnosticStatus {
  return (
    typeof value === "string" &&
    (DIAGNOSTIC_STATUSES as readonly string[]).includes(value)
  );
}
