import { describe, expect, it, vi } from "vitest";

import { GetRegisteredServiceResources } from "../../../src/service-management/application/get-registered-service-resources.js";
import { RegisteredServiceNotFoundError } from "../../../src/service-management/application/registered-service-not-found-error.js";
import type { ServiceResourceReader } from "../../../src/service-management/application/ports/service-resource-reader.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { ServiceResourceObservation } from "../../../src/service-management/domain/service-resource-observation.js";

const observedAt = new Date("2026-01-01T12:00:00.000Z");

function svc(): RegisteredService {
  return RegisteredService.create({
    id: "task-manager",
    displayName: "Task Manager",
    managementAdapter: "pm2",
    externalResourceId: "task-manager",
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "always" },
  });
}

function reader(
  result: ServiceResourceObservation | (() => never),
): ServiceResourceReader {
  return {
    read:
      typeof result === "function"
        ? vi.fn().mockImplementation(result)
        : vi.fn().mockResolvedValue(result),
  };
}

describe("GetRegisteredServiceResources", () => {
  it("returns the reader's observation for a known service", async () => {
    const s = svc();
    const catalog = { list: vi.fn(), findById: vi.fn().mockResolvedValue(s) };
    const observation: ServiceResourceObservation = {
      outcome: "available",
      observedAt: "2026-01-01T12:00:00.000Z",
      cpu: { outcome: "available", usagePercent: 3 },
      memory: {
        outcome: "available",
        usageBytes: 100,
        limitBytes: null,
        usagePercent: null,
      },
      uptimeSeconds: 60,
    };
    const clock = { now: vi.fn(() => observedAt) };
    const useCase = new GetRegisteredServiceResources(
      catalog,
      reader(observation),
      clock,
    );
    await expect(useCase.execute("task-manager")).resolves.toEqual(observation);
  });

  it("rejects an unknown service", async () => {
    const catalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(null),
    };
    const clock = { now: vi.fn(() => observedAt) };
    const useCase = new GetRegisteredServiceResources(
      catalog,
      reader(() => {
        throw new Error("must not be called");
      }),
      clock,
    );
    await expect(useCase.execute("unknown")).rejects.toThrow(
      RegisteredServiceNotFoundError,
    );
  });

  it("converts an unexpected reader failure into an unavailable observation instead of propagating it", async () => {
    const s = svc();
    const catalog = { list: vi.fn(), findById: vi.fn().mockResolvedValue(s) };
    const clock = { now: vi.fn(() => observedAt) };
    const useCase = new GetRegisteredServiceResources(
      catalog,
      reader(() => {
        throw new Error("unexpected reader bug");
      }),
      clock,
    );
    await expect(useCase.execute("task-manager")).resolves.toEqual({
      outcome: "unavailable",
      observedAt: observedAt.toISOString(),
      reason: "unavailable",
    });
  });
});
