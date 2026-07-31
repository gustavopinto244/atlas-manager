import { describe, expect, it } from "vitest";
import { createRegisteredServicesStopResult } from "../../../src/service-management/domain/registered-services-stop-result.js";
const at = "2026-08-03T21:00:00.000Z";
describe("registered services stop result", () => {
  it("accepts and freezes stopped, already_stopped, and failed steps", () => {
    const result = createRegisteredServicesStopResult({
      authority: "machine_shutdown",
      requestedAt: at,
      successful: false,
      steps: [
        { serviceId: "api", outcome: "stopped" },
        { serviceId: "worker", outcome: "already_stopped" },
        {
          serviceId: "database",
          outcome: "failed",
          failureCode: "service_stop_failed",
        },
      ],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.steps)).toBe(true);
    expect(Object.isFrozen(result.steps[2])).toBe(true);
  });
  it("rejects invalid IDs, unknown fields, and invalid combinations", () => {
    const base = {
      authority: "machine_shutdown",
      requestedAt: at,
      successful: true,
      steps: [],
    };
    expect(() =>
      createRegisteredServicesStopResult({ ...base, extra: true }),
    ).toThrow();
    expect(() =>
      createRegisteredServicesStopResult({
        ...base,
        steps: [{ serviceId: "Bad", outcome: "stopped" }],
      }),
    ).toThrow();
    expect(() =>
      createRegisteredServicesStopResult({
        ...base,
        steps: [{ serviceId: "api", outcome: "failed" }],
      }),
    ).toThrow();
    expect(() =>
      createRegisteredServicesStopResult({
        ...base,
        steps: [
          {
            serviceId: "api",
            outcome: "stopped",
            failureCode: "service_stop_failed",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      createRegisteredServicesStopResult({
        ...base,
        successful: false,
        steps: [{ serviceId: "api", outcome: "stopped" }],
      }),
    ).toThrow();
    expect(() =>
      createRegisteredServicesStopResult({
        ...base,
        steps: [{ serviceId: "api", outcome: "stopped", extra: true }],
      }),
    ).toThrow();
  });
});
