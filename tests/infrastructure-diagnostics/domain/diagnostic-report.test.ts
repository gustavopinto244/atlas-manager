import { describe, expect, it } from "vitest";

import {
  CHECK_ID,
  CHECK_ORDER,
} from "../../../src/infrastructure-diagnostics/domain/check-ids.js";
import {
  createDiagnosticCheck,
  DIAGNOSTIC_TEXT_MAX_LENGTH,
} from "../../../src/infrastructure-diagnostics/domain/diagnostic-check.js";
import {
  createDiagnosticReport,
  deriveOverallStatus,
  orderDiagnosticChecks,
} from "../../../src/infrastructure-diagnostics/domain/diagnostic-report.js";
import type { DiagnosticCheckId } from "../../../src/infrastructure-diagnostics/domain/check-ids.js";
import type { DiagnosticStatus } from "../../../src/infrastructure-diagnostics/domain/diagnostic-status.js";

const OBSERVED_AT = "2026-01-01T00:00:00.000Z";

function check(id: DiagnosticCheckId, status: DiagnosticStatus) {
  return createDiagnosticCheck({ id, status, observedAt: OBSERVED_AT });
}

describe("deriveOverallStatus", () => {
  it("reports ok when every check is ok", () => {
    expect(
      deriveOverallStatus([
        check(CHECK_ID.atlasService, "ok"),
        check(CHECK_ID.nginxService, "ok"),
      ]),
    ).toBe("ok");
  });

  it("reports down when one check is down among healthy ones", () => {
    expect(
      deriveOverallStatus([
        check(CHECK_ID.atlasService, "ok"),
        check(CHECK_ID.nginxService, "down"),
        check(CHECK_ID.listenerAtlas, "ok"),
      ]),
    ).toBe("down");
  });

  it("ranks a definite outage above an undetermined diagnostic", () => {
    expect(
      deriveOverallStatus([
        check(CHECK_ID.nginxConfig, "unavailable"),
        check(CHECK_ID.atlasService, "down"),
      ]),
    ).toBe("down");
  });

  it("ranks an undetermined diagnostic above a degradation", () => {
    expect(
      deriveOverallStatus([
        check(CHECK_ID.nginxConfig, "unavailable"),
        check(CHECK_ID.listenerAtlas, "degraded"),
      ]),
    ).toBe("unavailable");
  });

  // The invariant that costs the most if it regresses: an operator who turned
  // power effects off must never be told their server is down because of it.
  it("reports disabled — never down — when every check is disabled", () => {
    const overall = deriveOverallStatus([
      check(CHECK_ID.powerPosture, "disabled"),
      check(CHECK_ID.schedulerBackup, "disabled"),
    ]);
    expect(overall).toBe("disabled");
    expect(overall).not.toBe("down");
  });

  it("reports disabled for an empty report", () => {
    expect(deriveOverallStatus([])).toBe("disabled");
  });

  it("never lets a disabled check mask a real degradation", () => {
    expect(
      deriveOverallStatus([
        check(CHECK_ID.powerPosture, "disabled"),
        check(CHECK_ID.listenerAtlas, "degraded"),
      ]),
    ).toBe("degraded");
  });

  it("never lets a disabled check worsen an otherwise healthy report", () => {
    expect(
      deriveOverallStatus([
        check(CHECK_ID.powerPosture, "disabled"),
        check(CHECK_ID.atlasService, "ok"),
      ]),
    ).toBe("ok");
  });
});

describe("orderDiagnosticChecks", () => {
  it("emits CHECK_ORDER regardless of the input ordering", () => {
    const shuffled = [...CHECK_ORDER].reverse().map((id) => check(id, "ok"));
    expect(orderDiagnosticChecks(shuffled).map((entry) => entry.id)).toEqual([
      ...CHECK_ORDER,
    ]);
  });

  it("produces the same order for two differently-ordered inputs", () => {
    const first = orderDiagnosticChecks([
      check(CHECK_ID.nginxConfig, "ok"),
      check(CHECK_ID.atlasService, "ok"),
      check(CHECK_ID.listenerAtlas, "ok"),
    ]);
    const second = orderDiagnosticChecks([
      check(CHECK_ID.listenerAtlas, "ok"),
      check(CHECK_ID.nginxConfig, "ok"),
      check(CHECK_ID.atlasService, "ok"),
    ]);
    expect(first.map((entry) => entry.id)).toEqual(
      second.map((entry) => entry.id),
    );
  });
});

describe("createDiagnosticReport", () => {
  it("derives the overall status from the ordered checks", () => {
    const report = createDiagnosticReport(OBSERVED_AT, [
      check(CHECK_ID.nginxService, "ok"),
      check(CHECK_ID.atlasService, "down"),
    ]);
    expect(report.overallStatus).toBe("down");
    expect(report.checks.map((entry) => entry.id)).toEqual([
      CHECK_ID.atlasService,
      CHECK_ID.nginxService,
    ]);
    expect(report.generatedAt).toBe(OBSERVED_AT);
  });
});

describe("createDiagnosticCheck", () => {
  it("omits optional fields rather than emitting undefined", () => {
    expect(check(CHECK_ID.atlasService, "ok")).toEqual({
      id: CHECK_ID.atlasService,
      status: "ok",
      observedAt: OBSERVED_AT,
    });
  });

  it("bounds every free-text field so a probe cannot inflate the response", () => {
    const long = "x".repeat(DIAGNOSTIC_TEXT_MAX_LENGTH * 3);
    const bounded = createDiagnosticCheck({
      id: CHECK_ID.nginxConfig,
      status: "down",
      observedAt: OBSERVED_AT,
      observed: long,
      expected: long,
      errorCode: long,
      hint: long,
    });
    for (const value of [
      bounded.observed,
      bounded.expected,
      bounded.errorCode,
      bounded.hint,
    ])
      expect(value).toHaveLength(DIAGNOSTIC_TEXT_MAX_LENGTH);
  });

  it("emits requiresPrivilege only when the probe was actually refused", () => {
    expect(
      createDiagnosticCheck({
        id: CHECK_ID.atlasService,
        status: "unavailable",
        observedAt: OBSERVED_AT,
        requiresPrivilege: false,
      }).requiresPrivilege,
    ).toBeUndefined();
    expect(
      createDiagnosticCheck({
        id: CHECK_ID.atlasService,
        status: "unavailable",
        observedAt: OBSERVED_AT,
        requiresPrivilege: true,
      }).requiresPrivilege,
    ).toBe(true);
  });
});
