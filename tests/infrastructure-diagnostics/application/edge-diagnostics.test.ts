import { describe, expect, it, vi } from "vitest";

import {
  buildInfrastructureDiagnosticReport,
  type InfrastructureDiagnosticSources,
} from "../../../src/infrastructure-diagnostics/application/build-infrastructure-diagnostic-report.js";
import { CHECK_ID } from "../../../src/infrastructure-diagnostics/domain/check-ids.js";
import type { DiagnosticReport } from "../../../src/infrastructure-diagnostics/domain/diagnostic-report.js";
import type { DiagnosticStatus } from "../../../src/infrastructure-diagnostics/domain/diagnostic-status.js";

const clock = Object.freeze({
  now: () => new Date("2026-02-02T10:00:00.000Z"),
});

function statusOf(report: DiagnosticReport, id: string): DiagnosticStatus {
  const check = report.checks.find((entry) => entry.id === id);
  if (check === undefined) throw new Error(`missing check: ${id}`);
  return check.status;
}

/**
 * The edge checks share one systemd reader, so the reader is keyed by unit name
 * to prove the three checks really are independent rather than three views of
 * one outcome.
 */
function sources(
  units: Readonly<Record<string, "active" | "failed" | "throw">>,
  nginxConfig: InfrastructureDiagnosticSources["nginxConfigTestRunner"],
): InfrastructureDiagnosticSources {
  return {
    clock,
    systemdUnitStateReader: {
      read: vi.fn(async (unitName: string) => {
        const state = units[unitName] ?? "active";
        if (state === "throw") throw new Error("probe failed");
        return {
          outcome: "observed" as const,
          activeState: state,
          subState: state === "active" ? "running" : "failed",
          unitFileState: "enabled",
        };
      }),
    },
    ...(nginxConfig === undefined
      ? {}
      : { nginxConfigTestRunner: nginxConfig }),
  };
}

describe("nginx and cloudflared diagnostics", () => {
  it("reports nginx.service, nginx.config and tunnel.cloudflared.service independently", async () => {
    const report = await buildInfrastructureDiagnosticReport(
      sources(
        { nginx: "active", cloudflared: "failed" },
        { run: async () => ({ outcome: "valid" as const }) },
      ),
    );
    expect(statusOf(report, CHECK_ID.nginxService)).toBe("ok");
    expect(statusOf(report, CHECK_ID.nginxConfig)).toBe("ok");
    expect(statusOf(report, CHECK_ID.tunnelCloudflaredService)).toBe("down");
  });

  it("keeps nginx.service healthy when only the configuration test fails", async () => {
    const report = await buildInfrastructureDiagnosticReport(
      sources(
        { nginx: "active", cloudflared: "active" },
        {
          run: async () => ({
            outcome: "invalid" as const,
            detail: "nginx: [emerg] unexpected }",
          }),
        },
      ),
    );
    expect(statusOf(report, CHECK_ID.nginxService)).toBe("ok");
    expect(statusOf(report, CHECK_ID.nginxConfig)).toBe("down");
    expect(statusOf(report, CHECK_ID.tunnelCloudflaredService)).toBe("ok");
    expect(report.overallStatus).toBe("down");
  });

  it("keeps the configuration test answerable when the nginx unit itself is down", async () => {
    const report = await buildInfrastructureDiagnosticReport(
      sources(
        { nginx: "failed", cloudflared: "active" },
        { run: async () => ({ outcome: "valid" as const }) },
      ),
    );
    expect(statusOf(report, CHECK_ID.nginxService)).toBe("down");
    expect(statusOf(report, CHECK_ID.nginxConfig)).toBe("ok");
  });

  it("contains a throwing config runner without touching the unit checks", async () => {
    const report = await buildInfrastructureDiagnosticReport(
      sources(
        { nginx: "active", cloudflared: "active" },
        {
          run: () => {
            throw new Error("runner exploded");
          },
        },
      ),
    );
    expect(statusOf(report, CHECK_ID.nginxConfig)).toBe("unavailable");
    expect(statusOf(report, CHECK_ID.nginxService)).toBe("ok");
    expect(statusOf(report, CHECK_ID.tunnelCloudflaredService)).toBe("ok");
  });

  it("surfaces an unresolvable nginx test as unavailable, not as a broken config", async () => {
    const report = await buildInfrastructureDiagnosticReport(
      sources(
        {},
        {
          run: async () => ({
            outcome: "undetermined" as const,
            code: "nginx_permission_denied" as const,
            requiresPrivilege: true,
          }),
        },
      ),
    );
    const check = report.checks.find(
      (entry) => entry.id === CHECK_ID.nginxConfig,
    );
    expect(check?.status).toBe("unavailable");
    expect(check?.requiresPrivilege).toBe(true);
  });

  it("carries the syntax-only scope boundary as a hint on nginx.config", async () => {
    const report = await buildInfrastructureDiagnosticReport(
      sources({}, { run: async () => ({ outcome: "valid" as const }) }),
    );
    const check = report.checks.find(
      (entry) => entry.id === CHECK_ID.nginxConfig,
    );
    expect(check?.hint).toContain("does not verify that requests reach Atlas");
  });
});
