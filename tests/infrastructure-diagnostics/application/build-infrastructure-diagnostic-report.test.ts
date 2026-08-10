import { describe, expect, it, vi } from "vitest";

import {
  buildInfrastructureDiagnosticReport,
  type InfrastructureDiagnosticSources,
} from "../../../src/infrastructure-diagnostics/application/build-infrastructure-diagnostic-report.js";
import {
  CHECK_ID,
  CHECK_ORDER,
} from "../../../src/infrastructure-diagnostics/domain/check-ids.js";
import type { DiagnosticCheck } from "../../../src/infrastructure-diagnostics/domain/diagnostic-check.js";
import type { DiagnosticReport } from "../../../src/infrastructure-diagnostics/domain/diagnostic-report.js";

const NOW = new Date("2026-02-02T10:00:00.000Z");
const clock = Object.freeze({ now: () => NOW });

function find(report: DiagnosticReport, id: string): DiagnosticCheck {
  const check = report.checks.find((entry) => entry.id === id);
  if (check === undefined) throw new Error(`missing check: ${id}`);
  return check;
}

function healthySources(): InfrastructureDiagnosticSources {
  return {
    clock,
    systemdUnitStateReader: {
      read: async () => ({
        outcome: "observed" as const,
        activeState: "active",
        subState: "running",
        unitFileState: "enabled",
      }),
    },
    tcpListenerReader: {
      read: async () => ({
        outcome: "observed" as const,
        listeners: [
          { port: 3000, binding: "loopback" as const, family: "ipv4" as const },
        ],
      }),
    },
    expectedListener: { port: 3000, binding: "loopback" },
    serverHealthReader: {
      execute: async () => ({ memoryUsagePercent: 40, diskUsagePercent: 55 }),
    },
    pm2ProcessListExecutor: {
      execute: async () =>
        JSON.stringify([{ name: "a", pm2_env: { status: "online" } }]),
    },
    backupSchedulerCursorReader: { read: async () => "2026-02-02T09:00:00Z" },
    powerSchedulerCursorReader: {
      read: async () => ({ lastTickAt: "2026-02-02T09:30:00Z" }),
    },
    eventHistoryReadinessReader: {
      execute: async () => ({ outcome: "ready" }),
    },
    powerPostureReader: {
      execute: () => ({ backend: "linux_helper", effects: "linux_helper" }),
    },
    nginxConfigTestRunner: { run: async () => ({ outcome: "valid" as const }) },
  };
}

describe("buildInfrastructureDiagnosticReport", () => {
  it("emits every check, in CHECK_ORDER, with the report's generatedAt", async () => {
    const report = await buildInfrastructureDiagnosticReport(healthySources());
    expect(report.checks.map((check) => check.id)).toEqual([...CHECK_ORDER]);
    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.overallStatus).toBe("ok");
  });

  // The adapter-layer half of the partial-failure obligation (ADR-032 §5.1).
  it("keeps every other check when one adapter throws", async () => {
    const report = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      systemdUnitStateReader: {
        read: async () => {
          throw new Error("systemd exploded");
        },
      },
    });
    expect(report.checks.map((check) => check.id)).toEqual([...CHECK_ORDER]);
    expect(find(report, CHECK_ID.atlasService).status).toBe("unavailable");
    expect(find(report, CHECK_ID.atlasHealthServer).status).toBe("ok");
    expect(find(report, CHECK_ID.listenerAtlas).status).toBe("ok");
    expect(find(report, CHECK_ID.schedulerBackup).status).toBe("ok");
    expect(find(report, CHECK_ID.nginxConfig).status).toBe("ok");
  });

  it("never rejects, even when every single adapter throws", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    const report = await buildInfrastructureDiagnosticReport({
      clock,
      systemdUnitStateReader: { read: boom },
      tcpListenerReader: { read: boom },
      nginxConfigTestRunner: { run: boom },
      expectedListener: { port: 3000, binding: "loopback" },
      serverHealthReader: { execute: boom },
      pm2ProcessListExecutor: { execute: boom },
      backupSchedulerCursorReader: { read: boom },
      powerSchedulerCursorReader: { read: boom },
      eventHistoryReadinessReader: { execute: boom },
      powerPostureReader: { execute: boom },
    });
    expect(report.checks).toHaveLength(CHECK_ORDER.length);
    expect(report.overallStatus).toBe("unavailable");
  });

  it("orders checks deterministically regardless of settle timing", async () => {
    const slowThenFast = (delays: readonly number[]) => {
      let call = 0;
      return async () => {
        const delay = delays[call++ % delays.length] ?? 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return {
          outcome: "observed" as const,
          activeState: "active",
          subState: "running",
          unitFileState: "enabled",
        };
      };
    };
    const first = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      systemdUnitStateReader: { read: slowThenFast([5, 0, 0]) },
    });
    const second = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      systemdUnitStateReader: { read: slowThenFast([0, 0, 5]) },
    });
    expect(first.checks.map((check) => check.id)).toEqual(
      second.checks.map((check) => check.id),
    );
  });

  it("reports an uncomposed source as disabled, never as down", async () => {
    const report = await buildInfrastructureDiagnosticReport({ clock });
    for (const check of report.checks)
      expect([check.id, check.status]).not.toEqual([check.id, "down"]);
    expect(find(report, CHECK_ID.schedulerBackup).status).toBe("disabled");
    expect(find(report, CHECK_ID.atlasService).status).toBe("disabled");
    // atlas.health.live is the one check that answers from the process itself.
    expect(find(report, CHECK_ID.atlasHealthLive).status).toBe("ok");
    expect(report.overallStatus).toBe("ok");
  });

  it("reads power effects switched off as disabled, keeping the report calm", async () => {
    const report = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      powerPostureReader: {
        execute: () => ({ backend: "mock", effects: "disabled" }),
      },
    });
    expect(find(report, CHECK_ID.powerPosture).status).toBe("disabled");
    expect(report.overallStatus).toBe("ok");
  });

  it("reports a masked or disabled unit file as disabled rather than down", async () => {
    const report = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      systemdUnitStateReader: {
        read: async () => ({
          outcome: "observed" as const,
          activeState: "inactive",
          subState: "dead",
          unitFileState: "masked",
        }),
      },
    });
    expect(find(report, CHECK_ID.tunnelCloudflaredService).status).toBe(
      "disabled",
    );
  });

  it("reports a failed unit as down", async () => {
    const report = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      systemdUnitStateReader: {
        read: async () => ({
          outcome: "observed" as const,
          activeState: "failed",
          subState: "failed",
          unitFileState: "enabled",
        }),
      },
    });
    expect(find(report, CHECK_ID.atlasService).status).toBe("down");
    expect(report.overallStatus).toBe("down");
  });

  it("surfaces a privilege refusal as unavailable and never auto-elevates", async () => {
    const read = vi.fn(async () => ({
      outcome: "undetermined" as const,
      code: "systemd_permission_denied" as const,
      requiresPrivilege: true,
    }));
    const report = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      systemdUnitStateReader: { read },
    });
    const check = find(report, CHECK_ID.atlasService);
    expect(check.status).toBe("unavailable");
    expect(check.requiresPrivilege).toBe(true);
    // Three units, one probe each. A retry here would be an implicit
    // escalation attempt.
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("reports a missing listener as down and a widened bind as degraded", async () => {
    const missing = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      tcpListenerReader: {
        read: async () => ({ outcome: "observed" as const, listeners: [] }),
      },
    });
    expect(find(missing, CHECK_ID.listenerAtlas).status).toBe("down");

    const widened = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      tcpListenerReader: {
        read: async () => ({
          outcome: "observed" as const,
          listeners: [
            {
              port: 3000,
              binding: "wildcard" as const,
              family: "ipv4" as const,
            },
          ],
        }),
      },
    });
    expect(find(widened, CHECK_ID.listenerAtlas).status).toBe("degraded");
  });

  it("reports an unwritable audit trail as down", async () => {
    const report = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      eventHistoryReadinessReader: {
        execute: async () => ({
          outcome: "unavailable",
          code: "event_history_corrupted",
        }),
      },
    });
    const check = find(report, CHECK_ID.eventHistoryReadiness);
    expect(check.status).toBe("down");
    expect(check.errorCode).toBe("event_history_corrupted");
  });

  it("degrades on host pressure without claiming an outage", async () => {
    const report = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      serverHealthReader: {
        execute: async () => ({ memoryUsagePercent: 42, diskUsagePercent: 97 }),
      },
    });
    expect(find(report, CHECK_ID.atlasHealthServer).status).toBe("degraded");
    expect(report.overallStatus).toBe("degraded");
  });

  it("never emits a PM2 process name, only a count", async () => {
    const report = await buildInfrastructureDiagnosticReport({
      ...healthySources(),
      pm2ProcessListExecutor: {
        execute: async () =>
          JSON.stringify([
            {
              name: "private-deployment-secret",
              pm2_env: { status: "online" },
            },
            { name: "another", pm2_env: { status: "stopped" } },
          ]),
      },
    });
    const check = find(report, CHECK_ID.pm2Process);
    expect(check.observed).toBe("daemon reachable · 1 of 2 online");
    expect(JSON.stringify(report)).not.toContain("private-deployment-secret");
  });
});
