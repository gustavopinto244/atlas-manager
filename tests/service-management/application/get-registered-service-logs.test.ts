/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import {
  GetRegisteredServiceLogs,
  ServiceLogOperationNotSupportedError,
} from "../../../src/service-management/application/get-registered-service-logs.js";
import { RegisteredServiceNotFoundError } from "../../../src/service-management/application/registered-service-not-found-error.js";
import type { ServiceLogReader } from "../../../src/service-management/application/ports/service-log-reader.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { ServiceLogBatch } from "../../../src/service-management/domain/service-log-batch.js";

const observedAt = new Date("2026-01-01T12:00:00.000Z");
const clock = { now: vi.fn(() => observedAt) };

function createLogReader(result: ServiceLogBatch): ServiceLogReader {
  return { readLogs: vi.fn().mockResolvedValue(result) };
}

function sampleLog(serviceId: string): ServiceLogBatch {
  return {
    serviceId,
    collectedAt: "2026-01-01T12:00:00.000Z",
    stdoutLines: Object.freeze(["line1"]),
    stderrLines: Object.freeze([]),
    truncated: false,
  };
}

function svc(
  overrides: Partial<{ id: string; ops: string[] }> = {},
): RegisteredService {
  return RegisteredService.create({
    id: overrides.id ?? "docker-svc",
    displayName: "Svc",
    managementAdapter: "docker",
    externalResourceId: "c",
    supportedOperations: overrides.ops ?? ["readStatus", "readLogs"],
    availabilityPolicy: { mode: "manual" },
  });
}

describe("GetRegisteredServiceLogs", () => {
  it.each([undefined, 1, 100, 500])("accepts tailLines=%s", async (tl) => {
    const s = svc();
    const catalog = { list: vi.fn(), findById: vi.fn().mockResolvedValue(s) };
    const r = createLogReader(sampleLog("docker-svc"));
    const getLogs = new GetRegisteredServiceLogs(catalog, r, clock);
    await getLogs.execute("docker-svc", tl);
    expect(r.readLogs).toHaveBeenCalledWith(s, tl ?? 100, observedAt);
  });

  it.each([0, -1, 501, 10.5])("rejects tailLines=%s", async (tl) => {
    const s = svc();
    const catalog = { list: vi.fn(), findById: vi.fn().mockResolvedValue(s) };
    const r = createLogReader(sampleLog("docker-svc"));
    const getLogs = new GetRegisteredServiceLogs(catalog, r, clock);
    await expect(getLogs.execute("docker-svc", tl)).rejects.toThrow();
  });

  it("rejects unknown service", async () => {
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(null),
    };
    const getLogs = new GetRegisteredServiceLogs(
      catalog,
      createLogReader(sampleLog("x")),
      clock,
    );
    await expect(getLogs.execute("unknown")).rejects.toThrow(
      RegisteredServiceNotFoundError,
    );
  });

  it("rejects service without readLogs", async () => {
    const s = svc({ ops: ["readStatus"] });
    const catalog = { list: vi.fn(), findById: vi.fn().mockResolvedValue(s) };
    const getLogs = new GetRegisteredServiceLogs(
      catalog,
      createLogReader(sampleLog("docker-svc")),
      clock,
    );
    await expect(getLogs.execute("docker-svc")).rejects.toThrow(
      ServiceLogOperationNotSupportedError,
    );
  });

  it("preserves exact result and captures one clock instant", async () => {
    const s = svc();
    const catalog = { list: vi.fn(), findById: vi.fn().mockResolvedValue(s) };
    const batch = sampleLog("docker-svc");
    const r = createLogReader(batch);
    const localClock = { now: vi.fn(() => observedAt) };
    const getLogs = new GetRegisteredServiceLogs(catalog, r, localClock);
    const result = await getLogs.execute("docker-svc", 50);
    expect(result.stdoutLines).toEqual(["line1"]);
    expect(result.collectedAt).toBe("2026-01-01T12:00:00.000Z");
    expect(localClock.now).toHaveBeenCalledOnce();
  });
});
