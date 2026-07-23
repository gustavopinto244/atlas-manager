import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import { Pm2ServiceStatusReader } from "../../../src/service-management/infrastructure/pm2-service-status-reader.js";

function createService(
  externalResourceId = "atlas-api-process",
  managementAdapter: "mock" | "pm2" = "pm2",
): RegisteredService {
  return RegisteredService.create({
    id: "stable-atlas-service",
    displayName: "Atlas API",
    managementAdapter,
    externalResourceId,
    supportedOperations: ["readStatus"],
  });
}

function createExecutor(output: string): Pm2ProcessListExecutor {
  return {
    execute: vi.fn().mockResolvedValue(output),
  };
}

function processEntry(name: unknown, status: unknown): Record<string, unknown> {
  return {
    name,
    pm_id: 42,
    pid: 8_421,
    monit: { cpu: 83, memory: 1_000_000 },
    pm2_env: {
      status,
      pm_cwd: "/private/application",
      pm_out_log_path: "/private/logs/output.log",
      secret: "credential-value",
    },
  };
}

describe("Pm2ServiceStatusReader", () => {
  it("rejects a non-PM2 service before executing the process list", async () => {
    const execute = vi.fn().mockResolvedValue("[]");
    const executor: Pm2ProcessListExecutor = { execute };
    const reader = new Pm2ServiceStatusReader(executor);

    await expect(
      reader.read(createService("mock-target", "mock")),
    ).rejects.toEqual(
      expect.objectContaining({ code: "unsupported_status_adapter" }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["online", "running"],
    ["stopped", "stopped"],
    ["errored", "failed"],
    ["launching", "unknown"],
    ["stopping", "unknown"],
    ["waiting_restart", "unknown"],
    ["another-valid-state", "unknown"],
  ] as const)("maps PM2 %s to %s", async (pm2Status, expectedState) => {
    const output = JSON.stringify([
      processEntry("atlas-api-process", pm2Status),
    ]);
    const reader = new Pm2ServiceStatusReader(createExecutor(output));

    await expect(reader.read(createService())).resolves.toBe(expectedState);
  });

  it("matches the first process exactly by external resource ID", async () => {
    const output = JSON.stringify([
      processEntry("atlas-api-process", "online"),
      processEntry("unrelated-process", "stopped"),
    ]);
    const reader = new Pm2ServiceStatusReader(createExecutor(output));

    await expect(reader.read(createService())).resolves.toBe("running");
  });

  it("matches a later process exactly by external resource ID", async () => {
    const output = JSON.stringify([
      processEntry("unrelated-process", "stopped"),
      processEntry("atlas-api-process", "errored"),
    ]);
    const reader = new Pm2ServiceStatusReader(createExecutor(output));

    await expect(reader.read(createService())).resolves.toBe("failed");
  });

  it.each([
    ["an empty process list", "[]"],
    [
      "a missing exact process",
      JSON.stringify([processEntry("other-process", "online")]),
    ],
    [
      "a case-only variation",
      JSON.stringify([processEntry("ATLAS-API-PROCESS", "online")]),
    ],
    [
      "leading or trailing whitespace",
      JSON.stringify([processEntry(" atlas-api-process ", "online")]),
    ],
    [
      "the stable service ID instead of the external resource ID",
      JSON.stringify([processEntry("stable-atlas-service", "online")]),
    ],
    [
      "a matching numeric PM2 ID",
      JSON.stringify([
        {
          ...processEntry("other-process", "online"),
          pm_id: "atlas-api-process",
        },
      ]),
    ],
  ])("rejects %s as not found", async (_description, output) => {
    const reader = new Pm2ServiceStatusReader(createExecutor(output));

    await expect(reader.read(createService())).rejects.toEqual(
      expect.objectContaining({ code: "pm2_service_not_found" }),
    );
  });

  it("rejects duplicate exact PM2 process names", async () => {
    const output = JSON.stringify([
      processEntry("atlas-api-process", "online"),
      processEntry("atlas-api-process", "stopped"),
    ]);
    const reader = new Pm2ServiceStatusReader(createExecutor(output));

    await expect(reader.read(createService())).rejects.toEqual(
      expect.objectContaining({ code: "duplicate_pm2_service" }),
    );
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["non-array JSON", JSON.stringify({ processes: [] })],
    [
      "an entry without a name",
      JSON.stringify([{ pm2_env: { status: "online" } }]),
    ],
    ["a non-string process name", JSON.stringify([processEntry(42, "online")])],
    [
      "a selected process without pm2_env",
      JSON.stringify([{ name: "atlas-api-process" }]),
    ],
    [
      "a selected process without status",
      JSON.stringify([{ name: "atlas-api-process", pm2_env: {} }]),
    ],
    [
      "a selected process with non-string status",
      JSON.stringify([processEntry("atlas-api-process", 42)]),
    ],
  ])("rejects %s as invalid output", async (_description, output) => {
    const reader = new Pm2ServiceStatusReader(createExecutor(output));

    await expect(reader.read(createService())).rejects.toEqual(
      expect.objectContaining({ code: "pm2_status_output_invalid" }),
    );
  });

  it("discards unrelated PM2 fields and returns only the project state", async () => {
    const output = JSON.stringify([
      processEntry("atlas-api-process", "online"),
    ]);
    const reader = new Pm2ServiceStatusReader(createExecutor(output));

    const result = await reader.read(createService());

    expect(result).toBe("running");
    expect(JSON.stringify(result)).not.toContain("pm_id");
    expect(JSON.stringify(result)).not.toContain("pm_cwd");
    expect(JSON.stringify(result)).not.toContain("credential-value");
  });

  it("does not expose identifiers or raw PM2 details in errors", async () => {
    const serviceId = "stable-atlas-service";
    const externalResourceId = "atlas-api-process";
    const sensitiveOutput = JSON.stringify([
      {
        name: externalResourceId,
        pm2_env: { status: 42 },
        pid: 8_421,
        script: "/private/application/server.js",
        log: "/private/logs/output.log",
        environmentSecret: "credential-value",
      },
    ]);
    const reader = new Pm2ServiceStatusReader(createExecutor(sensitiveOutput));

    try {
      await reader.read(createService(externalResourceId));
      expect.unreachable("Expected PM2 output validation to fail");
    } catch (error) {
      const safeError = JSON.stringify(error);
      const safeMessage = String(error);

      for (const sensitiveValue of [
        serviceId,
        externalResourceId,
        "8421",
        "/private/application/server.js",
        "/private/logs/output.log",
        "credential-value",
        sensitiveOutput,
      ]) {
        expect(safeError).not.toContain(sensitiveValue);
        expect(safeMessage).not.toContain(sensitiveValue);
      }
    }
  });
});
