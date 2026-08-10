import { CHECK_ORDER, type DiagnosticCheckId } from "./check-ids.js";
import type { DiagnosticCheck } from "./diagnostic-check.js";
import type { DiagnosticStatus } from "./diagnostic-status.js";

export type DiagnosticReport = Readonly<{
  generatedAt: string;
  overallStatus: DiagnosticStatus;
  checks: readonly DiagnosticCheck[];
}>;

/**
 * Worst-first precedence over the *non-disabled* checks only.
 *
 * `unavailable` deliberately ranks better than `down`: "I could not determine
 * this" must not be louder than "this is definitely broken", or a permission
 * gap would drown out a real outage.
 */
const PRECEDENCE: Readonly<
  Record<Exclude<DiagnosticStatus, "disabled">, number>
> = Object.freeze({
  down: 0,
  unavailable: 1,
  degraded: 2,
  ok: 3,
});

/**
 * The single shared derivation (ADR-032 §6). The HTTP layer, the CLI and the
 * dashboard all call this function; none of them reimplements it, because three
 * copies of a precedence rule is three chances to disagree about whether the
 * system is healthy.
 *
 * `disabled` checks are excluded from the computation entirely. An
 * intentionally-off capability — power effects, a scheduler the operator never
 * enabled — must read as calm, never as an outage. If every check is disabled
 * (or there are none), the report itself is `disabled`.
 */
export function deriveOverallStatus(
  checks: readonly DiagnosticCheck[],
): DiagnosticStatus {
  const considered = checks.filter((check) => check.status !== "disabled");
  if (considered.length === 0) return "disabled";
  let worst: Exclude<DiagnosticStatus, "disabled"> = "ok";
  for (const check of considered) {
    const status = check.status as Exclude<DiagnosticStatus, "disabled">;
    if (PRECEDENCE[status] < PRECEDENCE[worst]) worst = status;
  }
  return worst;
}

/**
 * Deterministic emission order, independent of async completion timing
 * (ADR-032 §5). Anything outside `CHECK_ORDER` is appended in stable id order
 * rather than dropped, so a check added without updating the constant is
 * visible instead of silently missing.
 */
export function orderDiagnosticChecks(
  checks: readonly DiagnosticCheck[],
): readonly DiagnosticCheck[] {
  const rank = new Map<DiagnosticCheckId, number>(
    CHECK_ORDER.map((id, index) => [id, index]),
  );
  return Object.freeze(
    [...checks].sort((left, right) => {
      const leftRank = rank.get(left.id) ?? CHECK_ORDER.length;
      const rightRank = rank.get(right.id) ?? CHECK_ORDER.length;
      return leftRank === rightRank
        ? left.id.localeCompare(right.id)
        : leftRank - rightRank;
    }),
  );
}

export function createDiagnosticReport(
  generatedAt: string,
  checks: readonly DiagnosticCheck[],
): DiagnosticReport {
  const ordered = orderDiagnosticChecks(checks);
  return Object.freeze({
    generatedAt,
    overallStatus: deriveOverallStatus(ordered),
    checks: ordered,
  });
}
