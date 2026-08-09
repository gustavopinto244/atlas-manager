import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../src/service-management/domain/registered-service.js";
import { RegisteredServiceStatus } from "../../src/service-management/domain/registered-service-status.js";
import { FixedAdministrativeRequestAdmission } from "../../src/http/administrative-request-admission.js";
import { FixedAdministrativePowerOperationGate } from "../../src/http/administrative-power-operation-gate.js";
import { createApp } from "../../src/http/create-app.js";
import type { ServerHealthSnapshot } from "../../src/server-health/domain/server-health-snapshot.js";
import { parseAdministrativePublicOrigin } from "../../src/http/administrative-public-origin.js";

const service = RegisteredService.create({
  id: "atlas-api",
  displayName: "Atlas API",
  managementAdapter: "mock",
  externalResourceId: "atlas-api-target",
  supportedOperations: ["readStatus", "start", "stop", "restart"],
  availabilityPolicy: { mode: "always" },
});
const status = RegisteredServiceStatus.create({
  serviceId: service.id,
  state: "stopped",
  observedAt: "2026-01-01T00:00:00.000Z",
});

function base() {
  const clock = { now: vi.fn(() => new Date("2026-01-01T00:00:00.000Z")) };
  const snapshot: ServerHealthSnapshot = {
    capturedAtIso: "2026-01-01T00:00:00.000Z",
    uptimeSeconds: 1,
    totalMemoryBytes: 100,
    freeMemoryBytes: 50,
    usedMemoryBytes: 50,
    memoryUsagePercent: 50,
    cpuUsagePercent: 1,
    cpuTemperatureCelsius: null,
    cpuLoadAverage1Minute: 0,
    cpuLoadAverage5Minutes: 0,
    cpuLoadAverage15Minutes: 0,
    diskTotalBytes: 100,
    diskAvailableBytes: 50,
    diskUsedBytes: 50,
    diskUsagePercent: 50,
  };
  return {
    logger: { error: vi.fn() },
    getServerHealth: { execute: vi.fn(async () => snapshot) },
    clock,
  };
}

function serviceDependencies(overrides: Record<string, unknown> = {}) {
  const values = {
    getRegisteredServices: {
      execute: vi.fn(async () => [
        { service, status, effectiveAvailability: "available" },
      ]),
    },
    getRegisteredService: {
      execute: vi.fn(async () => ({
        service,
        status,
        effectiveAvailability: "available",
      })),
    },
    getRegisteredServiceLogs: {
      execute: vi.fn(async () => ({
        serviceId: service.id,
        collectedAt: "2026-01-01T00:00:00.000Z",
        stdoutLines: ["ready"],
        stderrLines: [],
        truncated: false,
      })),
    },
    startRegisteredService: {
      execute: vi.fn(async () => ({
        targetServiceId: service.id,
        requestedOperation: "start",
        successful: true,
      })),
    },
    stopRegisteredService: {
      execute: vi.fn(async () => ({
        targetServiceId: service.id,
        requestedOperation: "stop",
        successful: true,
      })),
    },
    restartRegisteredService: {
      execute: vi.fn(async () => ({
        targetServiceId: service.id,
        requestedOperation: "restart",
        successful: true,
      })),
    },
    ...overrides,
  };
  return {
    admission: new FixedAdministrativeRequestAdmission(base().clock),
    mutationGate: new FixedAdministrativePowerOperationGate(),
    createProtectedAdministration: vi.fn(() => values),
    values,
  };
}

describe("administrative control-plane routes", () => {
  it("serves the dashboard only from the dedicated administrative authority", async () => {
    const clock = base().clock;
    const app = createApp({
      ...base(),
      administrativePublicOrigin: parseAdministrativePublicOrigin(
        "https://admin.gustavopinto.dev.br",
      ),
      administrativeDashboard: {
        admission: new FixedAdministrativeRequestAdmission(clock),
        createProtectedAdministration: vi.fn(() => ({
          getAdministrativeDashboard: { execute: vi.fn(async () => ({})) },
        })),
      },
    });
    const dashboard = await request(app)
      .get("/")
      .set("host", "admin.gustavopinto.dev.br");
    expect(dashboard.status).toBe(200);
    expect(
      (await request(app).get("/").set("host", "gustavopinto.dev.br")).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/admin")
          .set("host", "admin.gustavopinto.dev.br")
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/assets/styles.css")
          .set("host", "admin.gustavopinto.dev.br")
      ).status,
    ).toBe(200);
  });

  it("remain absent when the service surface is disabled", async () => {
    const response = await request(createApp({ ...base() })).get(
      "/admin/services",
    );
    expect(response.status).toBe(404);
  });

  it("maps and sorts the registered-service list", async () => {
    const dependencies = serviceDependencies({
      getRegisteredServices: {
        execute: vi.fn(async () => [
          {
            service: { ...service, id: "zeta" },
            status,
            effectiveAvailability: "available",
          },
          { service, status, effectiveAvailability: "unavailable" },
        ]),
      },
    });
    const response = await request(
      createApp({ ...base(), administrativeServices: dependencies }),
    ).get("/admin/services");
    expect(response.status).toBe(200);
    const body = response.body as {
      services: readonly { id: string }[];
    };
    expect(body.services.map((entry) => entry.id)).toEqual([
      "atlas-api",
      "zeta",
    ]);
    expect(body.services[0]).toEqual(
      expect.objectContaining({
        id: "atlas-api",
        displayName: "Atlas API",
        managementKind: "mock",
        dependencies: [],
      }),
    );
    expect(response.headers["cache-control"]).toBe("no-store, private");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("requires the exact mutation confirmation and never passes it to the capability", async () => {
    const dependencies = serviceDependencies();
    const app = createApp({ ...base(), administrativeServices: dependencies });
    const invalid = await request(app)
      .post("/admin/services/atlas-api/actions/start")
      .set("content-type", "application/json")
      .send({ confirmation: "confirm_registered_service_start", extra: true });
    expect(invalid.status).toBe(400);
    expect(
      dependencies.values.startRegisteredService.execute,
    ).not.toHaveBeenCalled();

    const valid = await request(app)
      .post("/admin/services/atlas-api/actions/start")
      .set("content-type", "application/json")
      .send({ confirmation: "confirm_registered_service_start" });
    expect(valid.status).toBe(200);
    expect(
      dependencies.values.startRegisteredService.execute,
    ).toHaveBeenCalledWith("atlas-api");
    expect(JSON.stringify(valid.body)).not.toContain("confirm_");
  });

  it("reads registered service logs through the protected service surface", async () => {
    const dependencies = serviceDependencies();
    const response = await request(
      createApp({ ...base(), administrativeServices: dependencies }),
    ).get("/admin/services/atlas-api/logs");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      serviceId: "atlas-api",
      collectedAt: "2026-01-01T00:00:00.000Z",
      stdoutLines: ["ready"],
      stderrLines: [],
      truncated: false,
    });
    expect(
      dependencies.values.getRegisteredServiceLogs.execute,
    ).toHaveBeenCalledWith("atlas-api");
  });

  it("supports availability reads and strict update/removal bodies", async () => {
    const availability = {
      getRegisteredServiceAvailability: {
        execute: vi.fn(async () => ({
          serviceId: service.id,
          policy: { mode: "always" },
          effectiveAvailability: "available",
          observedAt: "2026-01-01T00:00:00.000Z",
        })),
      },
      getRegisteredServiceAvailabilityPreview: {
        execute: vi.fn(async (_id: string, input: unknown) => input),
      },
      setRegisteredServiceAvailability: {
        execute: vi.fn(async (_id: string, policy: unknown) => policy),
      },
      removeRegisteredServiceAvailability: {
        execute: vi.fn(async () => undefined),
      },
    };
    const dependencies = {
      admission: new FixedAdministrativeRequestAdmission(base().clock),
      mutationGate: new FixedAdministrativePowerOperationGate(),
      createProtectedAdministration: vi.fn(() => availability),
    };
    const app = createApp({
      ...base(),
      administrativeServiceAvailability: dependencies,
    });
    expect(
      (await request(app).get("/admin/services/atlas-api/availability")).status,
    ).toBe(200);
    const preview = await request(app).get(
      "/admin/services/atlas-api/availability/preview?startsAt=2026-01-01T08:00:00.000Z&endsAt=2026-01-01T18:00:00.000Z",
    );
    expect(preview.status).toBe(200);
    expect(
      availability.getRegisteredServiceAvailabilityPreview.execute,
    ).toHaveBeenCalledWith("atlas-api", {
      startsAt: "2026-01-01T08:00:00.000Z",
      endsAt: "2026-01-01T18:00:00.000Z",
    });
    const updated = await request(app)
      .put("/admin/services/atlas-api/availability")
      .set("content-type", "application/json")
      .send({
        confirmation: "confirm_registered_service_availability_update",
        policy: { mode: "always" },
      });
    expect(updated.status).toBe(200);
    expect(
      availability.setRegisteredServiceAvailability.execute,
    ).toHaveBeenCalledWith("atlas-api", { mode: "always" });
    expect(
      (
        await request(app)
          .delete("/admin/services/atlas-api/availability")
          .set("content-type", "application/json")
          .send({
            confirmation: "confirm_registered_service_availability_removal",
          })
      ).status,
    ).toBe(200);
  });

  it("supports protected persistent schedule reads and strict mutations", async () => {
    const schedule = {
      getRegisteredServiceSchedule: {
        execute: vi.fn(async () => ({
          serviceId: service.id,
          policy: { mode: "always" },
          observedAt: "2026-01-01T00:00:00.000Z",
        })),
      },
      setRegisteredServiceSchedule: {
        execute: vi.fn(async (_id: string, policy: unknown) => policy),
      },
      removeRegisteredServiceSchedule: {
        execute: vi.fn(async () => undefined),
      },
    };
    const dependencies = {
      admission: new FixedAdministrativeRequestAdmission(base().clock),
      mutationGate: new FixedAdministrativePowerOperationGate(),
      createProtectedAdministration: vi.fn(() => schedule),
    };
    const app = createApp({
      ...base(),
      administrativeServiceSchedule: dependencies,
    });

    const read = await request(app).get("/admin/services/atlas-api/schedule");
    expect(read.status).toBe(200);
    expect(read.body).toEqual({
      serviceId: "atlas-api",
      policy: { mode: "always" },
      observedAt: "2026-01-01T00:00:00.000Z",
    });

    const invalid = await request(app)
      .put("/admin/services/atlas-api/schedule")
      .set("content-type", "application/json")
      .send({ confirmation: "wrong", policy: { mode: "always" } });
    expect(invalid.status).toBe(400);
    expect(
      schedule.setRegisteredServiceSchedule.execute,
    ).not.toHaveBeenCalled();

    const update = await request(app)
      .put("/admin/services/atlas-api/schedule")
      .set("content-type", "application/json")
      .send({
        confirmation: "confirm_registered_service_schedule_update",
        policy: { mode: "always" },
      });
    expect(update.status).toBe(200);
    expect(schedule.setRegisteredServiceSchedule.execute).toHaveBeenCalledWith(
      "atlas-api",
      { mode: "always" },
    );

    const removal = await request(app)
      .delete("/admin/services/atlas-api/schedule")
      .set("content-type", "application/json")
      .send({
        confirmation: "confirm_registered_service_schedule_removal",
      });
    expect(removal.status).toBe(200);
    expect(
      schedule.removeRegisteredServiceSchedule.execute,
    ).toHaveBeenCalledWith("atlas-api");
  });

  it("protects overview and dashboard delivery with the shared headers", async () => {
    const protectedAdministration = {
      getOperationsOverview: {
        execute: vi.fn(async () => ({
          services: { registered: 0 },
          availability: {},
          powerSafety: {
            backend: "mock",
            effects: "disabled",
            machineScheduler: "disabled",
            helper: "unused",
          },
        })),
      },
      getAdministrativeDashboard: { execute: vi.fn(async () => ({})) },
    };
    const admission = new FixedAdministrativeRequestAdmission(base().clock);
    const app = createApp({
      ...base(),
      administrativeOverview: {
        admission,
        createProtectedAdministration: vi.fn(() => protectedAdministration),
        getServerHealth: base().getServerHealth,
        applicationVersion: "0.1.0",
      },
      administrativeDashboard: {
        admission,
        createProtectedAdministration: vi.fn(() => protectedAdministration),
      },
    });
    const overview = await request(app).get("/admin/overview");
    expect(overview.status).toBe(200);
    const overviewBody = overview.body as {
      powerSafety: { backend: string };
    };
    expect(overviewBody.powerSafety.backend).toBe("mock");
    const dashboard = await request(app).get("/");
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(dashboard.text).toContain("Power safety");
    expect(dashboard.text).toContain("power-controls");
    const asset = await request(app).get("/assets/styles.css");
    expect(asset.status).toBe(200);
    const appAsset = await request(app).get("/assets/app.js");
    expect(appAsset.text).toContain("Execute prepared mock shutdown");
    expect(appAsset.text).toContain("/admin/power/shutdown/executions");
    expect(appAsset.text).toContain("Current wake alarm:");
    expect(appAsset.text).toContain("Explicit confirmation is required.");
    expect(appAsset.text).toContain("destructive-action");
  });

  it("reports enabled mock power controls from the administrative profile", async () => {
    const app = createApp({
      ...base(),
      administrativeOverview: {
        admission: new FixedAdministrativeRequestAdmission(base().clock),
        createProtectedAdministration: vi.fn(() => ({
          getOperationsOverview: {
            execute: vi.fn(async () => ({ powerSafety: { backend: "mock" } })),
          },
        })),
        getServerHealth: base().getServerHealth,
        applicationVersion: "1.0.0",
        administration: { wakeAlarmEnabled: true, shutdownEnabled: true },
      },
    });

    const response = await request(app).get("/admin/overview");

    expect(response.status).toBe(200);
    const body = response.body as {
      administration: {
        wakeAlarmEnabled: boolean;
        shutdownEnabled: boolean;
      };
    };
    expect(body.administration).toMatchObject({
      wakeAlarmEnabled: true,
      shutdownEnabled: true,
    });
  });

  it("rejects cross-site and malformed Fetch Metadata before route execution", async () => {
    const execute = vi.fn(async () => ({
      services: { registered: 0 },
      availability: {},
      powerSafety: {
        backend: "mock",
        effects: "disabled",
        machineScheduler: "disabled",
        helper: "unused",
      },
    }));
    const app = createApp({
      ...base(),
      administrativePublicOrigin: parseAdministrativePublicOrigin(
        "https://atlas.example.com",
      ),
      administrativeOverview: {
        admission: new FixedAdministrativeRequestAdmission(base().clock),
        createProtectedAdministration: vi.fn(() => ({
          getOperationsOverview: { execute },
        })),
        getServerHealth: base().getServerHealth,
        applicationVersion: "1.0.0-rc.6",
      },
    });
    const crossSite = await request(app)
      .get("/admin/overview")
      .set("host", "atlas.example.com")
      .set("sec-fetch-site", "cross-site");
    expect(crossSite.status).toBe(403);
    const malformed = await request(app)
      .get("/admin/overview")
      .set("host", "atlas.example.com")
      .set("sec-fetch-mode", "navigate")
      .set("sec-fetch-dest", "empty");
    expect(malformed.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});
