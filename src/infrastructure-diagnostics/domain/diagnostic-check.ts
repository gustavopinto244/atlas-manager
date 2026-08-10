import type { DiagnosticCheckId } from "./check-ids.js";
import type { DiagnosticStatus } from "./diagnostic-status.js";

/**
 * One independently-observed fact about the running infrastructure.
 *
 * `observed`, `expected` and `hint` are deliberately short *structural* facts —
 * "active", "inactive", "127.0.0.1:3000", "loopback" — and never raw command
 * output. ADR-032 §9 forbids secrets in this payload absolutely: no Cloudflare
 * Access JWT, no tunnel token or certificate content, no process environment,
 * no credential material of any kind. The adapters uphold that by constructing
 * these fields from classified enumerations rather than by echoing what a tool
 * printed.
 */
export type DiagnosticCheck = Readonly<{
  id: DiagnosticCheckId;
  status: DiagnosticStatus;
  observed?: string;
  expected?: string;
  errorCode?: string;
  hint?: string;
  /**
   * The diagnostic could not be completed because the running process lacks
   * the privilege to observe it. This is terminal by design: nothing anywhere
   * re-runs the probe with elevation (ADR-032 §9).
   */
  requiresPrivilege?: boolean;
  observedAt: string;
}>;

/** Bound on every free-text field so a probe can never inflate the response. */
export const DIAGNOSTIC_TEXT_MAX_LENGTH = 500;

export function createDiagnosticCheck(
  input: Readonly<{
    id: DiagnosticCheckId;
    status: DiagnosticStatus;
    observedAt: string;
    observed?: string;
    expected?: string;
    errorCode?: string;
    hint?: string;
    requiresPrivilege?: boolean;
  }>,
): DiagnosticCheck {
  return Object.freeze({
    id: input.id,
    status: input.status,
    ...(input.observed === undefined
      ? {}
      : { observed: bound(input.observed) }),
    ...(input.expected === undefined
      ? {}
      : { expected: bound(input.expected) }),
    ...(input.errorCode === undefined
      ? {}
      : { errorCode: bound(input.errorCode) }),
    ...(input.hint === undefined ? {} : { hint: bound(input.hint) }),
    ...(input.requiresPrivilege === true ? { requiresPrivilege: true } : {}),
    observedAt: input.observedAt,
  });
}

function bound(value: string): string {
  return value.length > DIAGNOSTIC_TEXT_MAX_LENGTH
    ? value.slice(0, DIAGNOSTIC_TEXT_MAX_LENGTH)
    : value;
}
