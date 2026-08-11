import { describe, expect, it } from "vitest";

import {
  ATLAS_SERVICE_ACTION_MUTATIONS,
  ATLAS_SERVICE_OPERATIONS,
  ATLAS_SERVICE_READ_PATH_TEMPLATE,
  ATLAS_SERVICE_SCHEDULE_ALIAS_MODES,
  ATLAS_SERVICE_SCHEDULE_MUTATIONS,
  ATLAS_SERVICE_SCHEDULE_OPERATIONS,
  ATLAS_SERVICE_SCHEDULE_READ_PATH_TEMPLATE,
  ATLAS_MACHINE_SCHEDULE_MUTATIONS,
  ATLAS_MACHINE_SCHEDULE_OPERATIONS,
  ATLAS_MACHINE_SCHEDULE_PATH,
  ATLAS_MACHINE_SCHEDULE_PREVIEW_PATH,
  ATLAS_BACKUP_ACTION_MUTATIONS,
  ATLAS_BACKUP_OPERATIONS,
  ATLAS_BACKUP_RETENTION_MUTATIONS,
  ATLAS_BACKUP_RETENTION_OPERATIONS,
  ATLAS_BACKUP_RETENTION_READ_PATH_TEMPLATE,
  ATLAS_BACKUP_SCHEDULE_MUTATIONS,
  ATLAS_BACKUP_SCHEDULE_OPERATIONS,
  ATLAS_BACKUP_SCHEDULE_READ_PATH_TEMPLATE,
  backupRetentionPath,
  backupRetentionPrunePath,
  backupSchedulePath,
  ATLAS_BACKUP_RUN_READ_PATH_TEMPLATE,
  ATLAS_BACKUP_TARGET_READ_PATH_TEMPLATE,
  backupActionPath,
  backupRunReadPath,
  backupTargetReadPath,
  isAtlasBackupRunId,
  isAtlasBackupTargetId,
  serviceActionPath,
  serviceReadPath,
  serviceSchedulePath,
} from "../../src/cli/administrative-contract.js";
import { SERVICE_AVAILABILITY_MODES } from "../../src/service-scheduling/domain/service-availability-mode.js";
import {
  ATLAS_DIAGNOSTIC_CHECK_ID_PREFIX,
  ATLAS_DIAGNOSTIC_NGINX_CONFIG_CHECK_ID,
  ATLAS_INFRASTRUCTURE_DIAGNOSTICS_PATH,
  ATLAS_INFRASTRUCTURE_DIAGNOSTICS_ROUTE_ID,
  atlasDiagnosticOverallStatus,
} from "../../src/cli/administrative-contract.js";
import { ADMINISTRATIVE_ROUTE_SECURITY_CATALOG } from "../../src/http/administrative-route-security-catalog.js";
import {
  CHECK_ID,
  CHECK_ID_PREFIX,
  CHECK_ORDER,
} from "../../src/infrastructure-diagnostics/domain/check-ids.js";
import { DIAGNOSTIC_STATUSES } from "../../src/infrastructure-diagnostics/domain/diagnostic-status.js";
import { deriveOverallStatus } from "../../src/infrastructure-diagnostics/domain/diagnostic-report.js";

function descriptorFor(routeId: string) {
  const descriptor = ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.find(
    (entry) => entry.routeId === routeId,
  );
  if (descriptor === undefined)
    throw new Error(`route descriptor missing: ${routeId}`);
  return descriptor;
}

describe("CLI administrative contract binding", () => {
  // The operator package ships only dist/cli, so the CLI cannot import the
  // server catalog at runtime. This test is what keeps its copy honest: if a
  // route id, method, path template or confirmation ever changes server-side,
  // the CLI's declaration fails here rather than in production.
  it("matches the canonical route security catalog for every service mutation", () => {
    for (const operation of ATLAS_SERVICE_OPERATIONS) {
      const declared = ATLAS_SERVICE_ACTION_MUTATIONS[operation];
      const canonical = descriptorFor(declared.routeId);
      expect(declared.routeId, operation).toBe(`services.${operation}`);
      expect(declared.method, operation).toBe(canonical.method);
      expect(declared.pathTemplate, operation).toBe(canonical.pathTemplate);
      expect(canonical.confirmationPolicy, operation).toBe(
        `exact:${declared.confirmation}`,
      );
    }
  });

  it("declares no confirmation the catalog does not require", () => {
    const catalogConfirmations = new Set(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.filter(
        (entry) => entry.confirmationPolicy !== "none",
      ).map((entry) => entry.confirmationPolicy),
    );
    for (const operation of ATLAS_SERVICE_OPERATIONS)
      expect(
        catalogConfirmations.has(
          `exact:${ATLAS_SERVICE_ACTION_MUTATIONS[operation].confirmation}`,
        ),
        operation,
      ).toBe(true);
  });

  it("binds the authoritative re-read to the catalog's single-service route", () => {
    expect(ATLAS_SERVICE_READ_PATH_TEMPLATE).toBe(
      descriptorFor("services.read").pathTemplate,
    );
  });

  it("keeps every service mutation behind authentication, RBAC and a mutation gate", () => {
    for (const operation of ATLAS_SERVICE_OPERATIONS) {
      const canonical = descriptorFor(`services.${operation}`);
      expect(canonical.authenticationPolicy, operation).toBe("required");
      expect(canonical.permission, operation).toBe(`services.${operation}`);
      expect(canonical.gatePolicy, operation).toBe("service_mutation");
      expect(canonical.auditPolicy, operation).toBe(
        "authorization_started_terminal",
      );
      expect(canonical.replayPolicy, operation).toBe("state_recheck_required");
    }
  });

  it("matches the canonical catalog for every service schedule mutation", () => {
    for (const operation of ATLAS_SERVICE_SCHEDULE_OPERATIONS) {
      const declared = ATLAS_SERVICE_SCHEDULE_MUTATIONS[operation];
      const canonical = descriptorFor(declared.routeId);
      expect(declared.routeId, operation).toBe(
        `services.schedule.${operation}`,
      );
      expect(declared.method, operation).toBe(canonical.method);
      expect(declared.pathTemplate, operation).toBe(canonical.pathTemplate);
      expect(canonical.confirmationPolicy, operation).toBe(
        `exact:${declared.confirmation}`,
      );
    }
  });

  it("declares no schedule confirmation the catalog does not require", () => {
    const catalogConfirmations = new Set(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.filter(
        (entry) => entry.confirmationPolicy !== "none",
      ).map((entry) => entry.confirmationPolicy),
    );
    for (const operation of ATLAS_SERVICE_SCHEDULE_OPERATIONS)
      expect(
        catalogConfirmations.has(
          `exact:${ATLAS_SERVICE_SCHEDULE_MUTATIONS[operation].confirmation}`,
        ),
        operation,
      ).toBe(true);
  });

  it("keeps every schedule mutation behind authentication, RBAC and a mutation gate", () => {
    for (const operation of ATLAS_SERVICE_SCHEDULE_OPERATIONS) {
      const canonical = descriptorFor(`services.schedule.${operation}`);
      expect(canonical.authenticationPolicy, operation).toBe("required");
      // Corrected during design review: the schedule routes are authorized by
      // services.availability.write, not a services.schedule.* permission.
      expect(canonical.permission, operation).toBe(
        "services.availability.write",
      );
      expect(canonical.gatePolicy, operation).toBe("service_mutation");
      expect(canonical.auditPolicy, operation).toBe(
        "authorization_started_terminal",
      );
      expect(canonical.replayPolicy, operation).toBe("state_recheck_required");
    }
  });

  it("binds the authoritative schedule re-read to the catalog's schedule route", () => {
    expect(ATLAS_SERVICE_SCHEDULE_READ_PATH_TEMPLATE).toBe(
      descriptorFor("services.schedule.read").pathTemplate,
    );
    expect(serviceSchedulePath("task-manager")).toBe(
      "/admin/services/task-manager/schedule",
    );
  });

  it("matches the canonical catalog for every machine schedule mutation", () => {
    for (const operation of ATLAS_MACHINE_SCHEDULE_OPERATIONS) {
      const declared = ATLAS_MACHINE_SCHEDULE_MUTATIONS[operation];
      const canonical = descriptorFor(declared.routeId);
      expect(declared.routeId, operation).toBe(`machine.schedule.${operation}`);
      expect(declared.method, operation).toBe(canonical.method);
      expect(declared.pathTemplate, operation).toBe(canonical.pathTemplate);
      expect(canonical.confirmationPolicy, operation).toBe(
        `exact:${declared.confirmation}`,
      );
    }
  });

  it("declares no machine schedule confirmation the catalog does not require", () => {
    const catalogConfirmations = new Set(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.filter(
        (entry) => entry.confirmationPolicy !== "none",
      ).map((entry) => entry.confirmationPolicy),
    );
    for (const operation of ATLAS_MACHINE_SCHEDULE_OPERATIONS)
      expect(
        catalogConfirmations.has(
          `exact:${ATLAS_MACHINE_SCHEDULE_MUTATIONS[operation].confirmation}`,
        ),
        operation,
      ).toBe(true);
  });

  it("keeps every machine schedule mutation behind authentication, RBAC and a mutation gate", () => {
    for (const operation of ATLAS_MACHINE_SCHEDULE_OPERATIONS) {
      const canonical = descriptorFor(`machine.schedule.${operation}`);
      expect(canonical.authenticationPolicy, operation).toBe("required");
      expect(canonical.permission, operation).toBe("power.schedule.write");
      expect(canonical.gatePolicy, operation).toBe("service_mutation");
      expect(canonical.auditPolicy, operation).toBe(
        "authorization_started_terminal",
      );
      expect(canonical.replayPolicy, operation).toBe("state_recheck_required");
    }
  });

  it("binds the authoritative machine schedule re-read to the catalog's route", () => {
    expect(ATLAS_MACHINE_SCHEDULE_PATH).toBe(
      descriptorFor("machine.schedule.read").pathTemplate,
    );
    expect(ATLAS_MACHINE_SCHEDULE_PREVIEW_PATH).toBe(
      descriptorFor("machine.schedule.preview").pathTemplate,
    );
    expect(descriptorFor("machine.schedule.read").permission).toBe(
      "power.schedule.read",
    );
    expect(descriptorFor("machine.schedule.preview").permission).toBe(
      "power.schedule.read",
    );
  });

  it("maps every alias subcommand to a mode the server domain actually accepts", () => {
    for (const [alias, mode] of Object.entries(
      ATLAS_SERVICE_SCHEDULE_ALIAS_MODES,
    )) {
      expect(SERVICE_AVAILABILITY_MODES, alias).toContain(mode);
      // `scheduled` needs a timezone and windows, so it can never be an alias.
      expect(mode, alias).not.toBe("scheduled");
    }
    // The verb the operator types is not always the mode the domain stores.
    expect(ATLAS_SERVICE_SCHEDULE_ALIAS_MODES.disable).toBe("disabled");
  });

  it("builds request paths by encoding the service id into the template", () => {
    expect(serviceActionPath("restart", "task-manager")).toBe(
      "/admin/services/task-manager/actions/restart",
    );
    expect(serviceReadPath("task-manager")).toBe(
      "/admin/services/task-manager",
    );
  });
});

describe("CLI administrative contract binding — backup operations", () => {
  it("matches the canonical route security catalog for every backup mutation", () => {
    for (const operation of ATLAS_BACKUP_OPERATIONS) {
      const declared = ATLAS_BACKUP_ACTION_MUTATIONS[operation];
      const canonical = descriptorFor(declared.routeId);
      expect(declared.routeId, operation).toBe(`backups.${operation}`);
      expect(declared.method, operation).toBe(canonical.method);
      expect(declared.pathTemplate, operation).toBe(canonical.pathTemplate);
      expect(canonical.confirmationPolicy, operation).toBe(
        `exact:${declared.confirmation}`,
      );
    }
  });

  it("declares no backup confirmation the catalog does not require", () => {
    const catalogConfirmations = new Set(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.filter(
        (entry) => entry.confirmationPolicy !== "none",
      ).map((entry) => entry.confirmationPolicy),
    );
    for (const operation of ATLAS_BACKUP_OPERATIONS)
      expect(
        catalogConfirmations.has(
          `exact:${ATLAS_BACKUP_ACTION_MUTATIONS[operation].confirmation}`,
        ),
        operation,
      ).toBe(true);
  });

  it("keeps the manual backup run behind authentication, RBAC and the backup gate", () => {
    const canonical = descriptorFor("backups.run");
    expect(canonical.authenticationPolicy).toBe("required");
    expect(canonical.permission).toBe("backups.run");
    // A separate gate from service_mutation: a busy backup and a busy service
    // operation never block each other.
    expect(canonical.gatePolicy).toBe("backup_operation");
    expect(canonical.auditPolicy).toBe("authorization_started_terminal");
  });

  it("binds the backup reads used by the CLI to the catalog's own routes", () => {
    expect(ATLAS_BACKUP_TARGET_READ_PATH_TEMPLATE).toBe(
      descriptorFor("backups.target.read").pathTemplate,
    );
    expect(ATLAS_BACKUP_RUN_READ_PATH_TEMPLATE).toBe(
      descriptorFor("backups.run.read").pathTemplate,
    );
  });

  it("builds backup request paths by encoding the identifier into the template", () => {
    expect(backupActionPath("run", "atlas-config")).toBe(
      "/admin/backups/targets/atlas-config/runs",
    );
    expect(backupTargetReadPath("atlas-config")).toBe(
      "/admin/backups/targets/atlas-config",
    );
    expect(backupRunReadPath("00000000-0000-4000-8000-000000000001")).toBe(
      "/admin/backups/runs/00000000-0000-4000-8000-000000000001",
    );
  });

  it("accepts only the identifier grammars the server accepts", () => {
    expect(isAtlasBackupTargetId("atlas-config")).toBe(true);
    expect(isAtlasBackupTargetId("Atlas_Config")).toBe(false);
    expect(isAtlasBackupTargetId("a".repeat(65))).toBe(false);
    // A backup target is never a filesystem path.
    expect(isAtlasBackupTargetId("/var/lib/atlas")).toBe(false);
    expect(isAtlasBackupRunId("00000000-0000-4000-8000-000000000001")).toBe(
      true,
    );
    expect(isAtlasBackupRunId("not-a-uuid")).toBe(false);
  });
});

describe("CLI administrative contract binding — backup policy mutations", () => {
  it("matches the canonical catalog for every backup schedule mutation", () => {
    for (const operation of ATLAS_BACKUP_SCHEDULE_OPERATIONS) {
      const declared = ATLAS_BACKUP_SCHEDULE_MUTATIONS[operation];
      const canonical = descriptorFor(declared.routeId);
      expect(declared.routeId, operation).toBe(`backups.schedule.${operation}`);
      expect(declared.method, operation).toBe(canonical.method);
      expect(declared.pathTemplate, operation).toBe(canonical.pathTemplate);
      expect(canonical.confirmationPolicy, operation).toBe(
        `exact:${declared.confirmation}`,
      );
      expect(canonical.permission, operation).toBe("backups.schedule.write");
      expect(canonical.gatePolicy, operation).toBe("backup_operation");
    }
  });

  it("matches the canonical catalog for every backup retention mutation", () => {
    for (const operation of ATLAS_BACKUP_RETENTION_OPERATIONS) {
      const declared = ATLAS_BACKUP_RETENTION_MUTATIONS[operation];
      const canonical = descriptorFor(declared.routeId);
      expect(declared.method, operation).toBe(canonical.method);
      expect(declared.pathTemplate, operation).toBe(canonical.pathTemplate);
      expect(canonical.confirmationPolicy, operation).toBe(
        `exact:${declared.confirmation}`,
      );
      expect(canonical.gatePolicy, operation).toBe("backup_operation");
    }
    // Pruning is a distinct permission from writing the policy: being allowed
    // to change how much is kept is not being allowed to delete what is kept.
    expect(descriptorFor("backups.retention.update").permission).toBe(
      "backups.retention.write",
    );
    expect(descriptorFor("backups.retention.prune").permission).toBe(
      "backups.retention.prune",
    );
  });

  it("declares no backup policy confirmation the catalog does not require", () => {
    const catalogConfirmations = new Set(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.filter(
        (entry) => entry.confirmationPolicy !== "none",
      ).map((entry) => entry.confirmationPolicy),
    );
    for (const declared of [
      ...Object.values(ATLAS_BACKUP_SCHEDULE_MUTATIONS),
      ...Object.values(ATLAS_BACKUP_RETENTION_MUTATIONS),
    ])
      expect(
        catalogConfirmations.has(`exact:${declared.confirmation}`),
        declared.routeId,
      ).toBe(true);
  });

  it("keeps the destructive prune behind a confirmation with no bypass", () => {
    const canonical = descriptorFor("backups.retention.prune");
    // The confirmation string is the only accepted authorization. There is no
    // catalog affordance for skipping it, and the CLI exposes no --force.
    expect(canonical.confirmationPolicy).toBe(
      "exact:confirm_registered_backup_retention_prune",
    );
    expect(canonical.authenticationPolicy).toBe("required");
    expect(canonical.auditPolicy).toBe("authorization_started_terminal");
  });

  it("binds the backup policy reads to the catalog's own routes", () => {
    expect(ATLAS_BACKUP_SCHEDULE_READ_PATH_TEMPLATE).toBe(
      descriptorFor("backups.schedule.read").pathTemplate,
    );
    expect(ATLAS_BACKUP_RETENTION_READ_PATH_TEMPLATE).toBe(
      descriptorFor("backups.retention.read").pathTemplate,
    );
    expect(backupSchedulePath("atlas-config")).toBe(
      "/admin/backups/targets/atlas-config/schedule",
    );
    expect(backupRetentionPath("atlas-config")).toBe(
      "/admin/backups/targets/atlas-config/retention",
    );
    expect(backupRetentionPrunePath("atlas-config")).toBe(
      "/admin/backups/targets/atlas-config/retention/prunes",
    );
  });

  it("declares no descriptor for the internal backup scheduler tick", () => {
    // The route exists server-side and stays deliberately unexposed: its
    // claim-protected replay policy makes it cron-triggered maintenance, not
    // an interactive operator command.
    expect(descriptorFor("backups.scheduler.tick").replayPolicy).toBe(
      "claim_protected",
    );
    const declared = [
      ...Object.values(ATLAS_BACKUP_ACTION_MUTATIONS),
      ...Object.values(ATLAS_BACKUP_SCHEDULE_MUTATIONS),
      ...Object.values(ATLAS_BACKUP_RETENTION_MUTATIONS),
    ].map((entry) => entry.routeId);
    expect(declared).not.toContain("backups.scheduler.tick");
  });
});

describe("CLI infrastructure diagnostics contract binding (ADR-032)", () => {
  it("binds the diagnostics path and route id to the catalog", () => {
    const canonical = descriptorFor(ATLAS_INFRASTRUCTURE_DIAGNOSTICS_ROUTE_ID);
    expect(ATLAS_INFRASTRUCTURE_DIAGNOSTICS_PATH).toBe(canonical.pathTemplate);
    expect(canonical.method).toBe("GET");
    // A diagnostics route that ever acquired a mutation policy would be a
    // silent upgrade of a read-only capability. It must fail here first.
    expect(canonical.replayPolicy).toBe("read_only");
    expect(canonical.confirmationPolicy).toBe("none");
    expect(canonical.gatePolicy).toBe("none");
    expect(canonical.requestPolicy.body).toBe("none");
    expect(canonical.permission).toBe("infrastructure.diagnostics.read");
  });

  it("mirrors the server's check-id namespace", () => {
    expect(ATLAS_DIAGNOSTIC_CHECK_ID_PREFIX).toEqual(CHECK_ID_PREFIX);
    expect(ATLAS_DIAGNOSTIC_NGINX_CONFIG_CHECK_ID).toBe(CHECK_ID.nginxConfig);
    for (const prefix of Object.values(ATLAS_DIAGNOSTIC_CHECK_ID_PREFIX))
      expect(
        CHECK_ORDER.some((id) => id.startsWith(prefix)),
        prefix,
      ).toBe(true);
  });

  /**
   * The CLI cannot import the domain at runtime (the operator package ships
   * only `dist/cli`), so it carries a copy of the precedence rule. This is what
   * stops that copy from becoming a second, divergent opinion about whether the
   * system is healthy: every combination of statuses must agree exactly.
   */
  it("agrees with the server's overall-status derivation for every status combination", () => {
    const statuses = [...DIAGNOSTIC_STATUSES];
    const observedAt = "2026-01-01T00:00:00.000Z";
    for (const first of statuses)
      for (const second of statuses)
        for (const third of statuses) {
          const checks = [first, second, third].map((status, index) => ({
            id: CHECK_ORDER[index]!,
            status,
            observedAt,
          }));
          expect(
            atlasDiagnosticOverallStatus(checks),
            `${first}/${second}/${third}`,
          ).toBe(deriveOverallStatus(checks));
        }
  });

  it("agrees with the server on an empty selection", () => {
    expect(atlasDiagnosticOverallStatus([])).toBe(deriveOverallStatus([]));
  });
});
