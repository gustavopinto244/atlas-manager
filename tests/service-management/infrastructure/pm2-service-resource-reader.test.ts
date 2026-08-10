import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import { Pm2ServiceResourceReader } from "../../../src/service-management/infrastructure/pm2-service-resource-reader.js";

const NOW = new Date("2026-01-01T00:10:00.000Z");
const clock = { now: () => NOW };

function createService(
  externalResourceId = "task-manager",
  managementAdapter: "mock" | "pm2" = "pm2",
): RegisteredService {
  return RegisteredService.create({
    id: "task-manager",
    displayName: "Task Manager",
    managementAdapter,
    externalResourceId,
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "always" },
  });
}

function createExecutor(output: string): Pm2ProcessListExecutor {
  return { execute: vi.fn().mockResolvedValue(output) };
}

function processEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "task-manager",
    pm_id: 0,
    monit: { cpu: 5, memory: 52_428_800 },
    pm2_env: {
      status: "online",
      pm_uptime: NOW.getTime() - 60_000,
    },
    ...overrides,
  };
}

describe("Pm2ServiceResourceReader", () => {
  it("reports available cpu, memory and uptime from monit and pm2_env", async () => {
    const executor = createExecutor(JSON.stringify([processEntry()]));
    const reader = new Pm2ServiceResourceReader(executor, clock);
    const observation = await reader.read(createService());
    expect(observation).toEqual({
      outcome: "available",
      observedAt: NOW.toISOString(),
      cpu: { outcome: "available", usagePercent: 5 },
      memory: {
        outcome: "available",
        usageBytes: 52_428_800,
        limitBytes: null,
        usagePercent: null,
      },
      uptimeSeconds: 60,
    });
  });

  it("reports unsupported for a non-pm2 service", async () => {
    const executor = createExecutor(JSON.stringify([processEntry()]));
    const reader = new Pm2ServiceResourceReader(executor, clock);
    const observation = await reader.read(createService("x", "mock"));
    expect(observation).toEqual({
      outcome: "unavailable",
      observedAt: NOW.toISOString(),
      reason: "unsupported",
    });
  });

  it("reports unavailable when the process is not found", async () => {
    const executor = createExecutor(JSON.stringify([]));
    const reader = new Pm2ServiceResourceReader(executor, clock);
    const observation = await reader.read(createService());
    expect(observation).toEqual({
      outcome: "unavailable",
      observedAt: NOW.toISOString(),
      reason: "unavailable",
    });
  });

  it("reports unavailable when the executor rejects (timeout, missing binary, etc.)", async () => {
    const executor: Pm2ProcessListExecutor = {
      execute: vi.fn().mockRejectedValue(new Error("pm2 jlist timed out")),
    };
    const reader = new Pm2ServiceResourceReader(executor, clock);
    const observation = await reader.read(createService());
    expect(observation).toEqual({
      outcome: "unavailable",
      observedAt: NOW.toISOString(),
      reason: "unavailable",
    });
  });

  it.each(["not json", "{}", "[1, 2]"])(
    "reports invalid_response for malformed output %s",
    async (output) => {
      const executor = createExecutor(output);
      const reader = new Pm2ServiceResourceReader(executor, clock);
      const observation = await reader.read(createService());
      expect(observation).toMatchObject({
        outcome: "unavailable",
        reason: output === "[1, 2]" ? "unavailable" : "invalid_response",
      });
    },
  );

  it("reports duplicate process names as unavailable rather than picking one", async () => {
    const executor = createExecutor(
      JSON.stringify([processEntry(), processEntry()]),
    );
    const reader = new Pm2ServiceResourceReader(executor, clock);
    const observation = await reader.read(createService());
    expect(observation).toMatchObject({
      outcome: "unavailable",
      reason: "unavailable",
    });
  });

  it("reports invalid_response for malformed monit values without failing the whole read", async () => {
    const executor = createExecutor(
      JSON.stringify([
        processEntry({ monit: { cpu: "not-a-number", memory: -1 } }),
      ]),
    );
    const reader = new Pm2ServiceResourceReader(executor, clock);
    const observation = await reader.read(createService());
    expect(observation).toMatchObject({
      outcome: "available",
      cpu: { outcome: "unavailable", reason: "invalid_response" },
      memory: { outcome: "unavailable", reason: "invalid_response" },
    });
  });

  it("reports null uptime when pm_uptime is missing or malformed", async () => {
    const executor = createExecutor(
      JSON.stringify([processEntry({ pm2_env: { status: "online" } })]),
    );
    const reader = new Pm2ServiceResourceReader(executor, clock);
    const observation = await reader.read(createService());
    expect(observation).toMatchObject({ uptimeSeconds: null });
  });

  it("never leaks command details through the returned observation", async () => {
    const executor: Pm2ProcessListExecutor = {
      execute: vi
        .fn()
        .mockRejectedValue(new Error("pm2 jlist failed: ENOENT /usr/bin/pm2")),
    };
    const reader = new Pm2ServiceResourceReader(executor, clock);
    const observation = await reader.read(createService());
    expect(JSON.stringify(observation)).not.toContain("pm2 jlist");
    expect(JSON.stringify(observation)).not.toContain("/usr/bin/pm2");
  });
});
