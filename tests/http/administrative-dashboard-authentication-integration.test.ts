import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createMachineOperatingPolicy } from "../../src/power-management/domain/machine-operating-policy.js";
import { createAdministrativeRuntime } from "../../src/http/create-administrative-runtime.js";
import { createApp } from "../../src/http/create-app.js";
import type { EnvironmentConfig } from "../../src/config/environment.js";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function config(eventHistoryFilePath: string): EnvironmentConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    logLevel: "info",
    powerManagementBackend: "mock",
    machinePowerEffectsActivation: Object.freeze({ kind: "disabled" }),
    machinePowerSchedulerEnabled: false,
    machineOperatingPolicy: createMachineOperatingPolicy({ mode: "always_on" }),
    administrativeEventHistoryHttpEnabled: false,
    administrativeWakeAlarmHttpEnabled: false,
    administrativeShutdownHttpEnabled: false,
    administrativeDashboardEnabled: true,
    administrativeOverviewHttpEnabled: true,
    administrativeEventHistoryFilePath: eventHistoryFilePath,
    administrativeRoleAssignments: [
      { principal: { principalId: PRINCIPAL_ID }, roles: ["administrator"] },
    ],
    cloudflareAccess: {
      teamName: "atlas",
      issuer: "https://atlas.cloudflareaccess.com",
      audience: "atlas-admin",
    },
  };
}

describe("administrative dashboard authentication integration", () => {
  it("fails closed for shell, overview, and assets without Cloudflare Access", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-dashboard-auth-"));
    roots.push(root);
    const runtime = createAdministrativeRuntime(
      config(join(root, "events.jsonl")),
    );
    const app = createApp({
      logger: { error: () => undefined },
      getServerHealth: {
        execute: async (): Promise<never> => {
          throw new Error("unreachable_without_authentication");
        },
      },
      ...(runtime.dashboard === undefined
        ? {}
        : { administrativeDashboard: runtime.dashboard }),
      ...(runtime.overview === undefined
        ? {}
        : { administrativeOverview: runtime.overview }),
    });

    for (const path of ["/", "/admin/overview", "/assets/app.js"]) {
      const response = await request(app).get(path);
      expect(response.status, path).toBe(401);
      expect(response.body).toEqual({
        error: {
          code: "administrative_authentication_required",
          message: "Administrative authentication required",
        },
      });
    }
  });
});
