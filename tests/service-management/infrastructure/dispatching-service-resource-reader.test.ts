/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  DispatchingServiceResourceReader,
  DispatchingServiceResourceReaderError,
} from "../../../src/service-management/infrastructure/dispatching-service-resource-reader.js";
import type { ServiceResourceReader } from "../../../src/service-management/application/ports/service-resource-reader.js";
import type { ServiceResourceObservation } from "../../../src/service-management/domain/service-resource-observation.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const clock = { now: () => NOW };

function svc(managementAdapter: "mock" | "pm2" | "docker" | "docker-compose") {
  return RegisteredService.create({
    id: "x",
    displayName: "X",
    managementAdapter,
    externalResourceId: "x",
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "manual" },
    ...(managementAdapter === "docker-compose"
      ? { managementConfiguration: { projectDirectory: "/tmp/x" } }
      : {}),
  });
}

function reader(
  observation: ServiceResourceObservation,
): ServiceResourceReader {
  return { read: vi.fn().mockResolvedValue(observation) };
}

const available: ServiceResourceObservation = {
  outcome: "available",
  observedAt: NOW.toISOString(),
  cpu: { outcome: "available", usagePercent: 1 },
  memory: {
    outcome: "available",
    usageBytes: 1,
    limitBytes: null,
    usagePercent: null,
  },
  uptimeSeconds: null,
};

describe("DispatchingServiceResourceReader", () => {
  it("routes to the reader matching the service's adapter", async () => {
    const pm2Reader = reader(available);
    const dispatcher = new DispatchingServiceResourceReader(
      {
        mock: reader(available),
        pm2: pm2Reader,
        docker: reader(available),
        "docker-compose": reader(available),
      },
      clock,
    );
    await dispatcher.read(svc("pm2"));
    expect(pm2Reader.read).toHaveBeenCalledOnce();
  });

  it("throws when a dependency does not implement the port", () => {
    expect(
      () =>
        new DispatchingServiceResourceReader(
          {
            mock: reader(available),
            pm2: reader(available),
            docker: reader(available),
            "docker-compose": {} as ServiceResourceReader,
          },
          clock,
        ),
    ).toThrow(DispatchingServiceResourceReaderError);
  });
});
