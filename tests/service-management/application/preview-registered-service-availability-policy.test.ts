import { describe, expect, it, vi } from "vitest";

import { PreviewRegisteredServiceAvailabilityPolicy } from "../../../src/service-management/application/preview-registered-service-availability-policy.js";
import { RegisteredServiceNotFoundError } from "../../../src/service-management/application/registered-service-not-found-error.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { ServiceAvailabilityModeValidationError } from "../../../src/service-scheduling/domain/service-availability-mode.js";
import type { ServiceAvailabilityOverride } from "../../../src/service-scheduling/domain/service-availability-override.js";

const service = RegisteredService.create({
  id: "atlas-api",
  displayName: "Atlas API",
  managementAdapter: "mock",
  externalResourceId: "atlas-api",
  supportedOperations: ["readStatus"],
  availabilityPolicy: { mode: "always" },
});

function catalog(found: RegisteredService | null = service) {
  return {
    list: vi.fn(async () => (found ? [found] : [])),
    findById: vi.fn(async () => found),
  };
}

function overrideStore(override: ServiceAvailabilityOverride | null = null) {
  return {
    findByServiceId: vi.fn(async () => override),
    save: vi.fn(),
    removeByServiceId: vi.fn(),
    removeByServiceIdIfMatches: vi.fn(),
  };
}

describe("PreviewRegisteredServiceAvailabilityPolicy", () => {
  it("evaluates a candidate scheduled policy without persisting it", async () => {
    const preview = new PreviewRegisteredServiceAvailabilityPolicy(
      catalog(),
      overrideStore(),
    );
    const result = await preview.execute({
      serviceId: "atlas-api",
      policy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
      startsAt: "2026-08-03T21:00:00.000Z",
      endsAt: "2026-08-04T12:00:00.000Z",
    });
    expect(result.serviceId).toBe("atlas-api");
    expect(result.outcome).toBeDefined();
  });

  it("tags the result as a candidate preview, distinct from a persisted-policy preview", async () => {
    const preview = new PreviewRegisteredServiceAvailabilityPolicy(
      catalog(),
      overrideStore(),
    );
    const result = await preview.execute({
      serviceId: "atlas-api",
      policy: { mode: "always" },
      startsAt: "2026-08-03T21:00:00.000Z",
      endsAt: "2026-08-04T12:00:00.000Z",
    });
    expect(result.source).toBe("candidate_preview");
  });

  it("evaluates a candidate always policy as always required", async () => {
    const preview = new PreviewRegisteredServiceAvailabilityPolicy(
      catalog(),
      overrideStore(),
    );
    const result = await preview.execute({
      serviceId: "atlas-api",
      policy: { mode: "always" },
      startsAt: "2026-08-03T21:00:00.000Z",
      endsAt: "2026-08-04T12:00:00.000Z",
    });
    expect(result.outcome).toBe("required");
  });

  it("rejects an unknown service", async () => {
    const preview = new PreviewRegisteredServiceAvailabilityPolicy(
      catalog(null),
      overrideStore(),
    );
    await expect(
      preview.execute({
        serviceId: "unknown",
        policy: { mode: "always" },
        startsAt: "2026-08-03T21:00:00.000Z",
        endsAt: "2026-08-04T12:00:00.000Z",
      }),
    ).rejects.toThrow(RegisteredServiceNotFoundError);
  });

  it("rejects an invalid candidate policy instead of silently coercing it", async () => {
    const preview = new PreviewRegisteredServiceAvailabilityPolicy(
      catalog(),
      overrideStore(),
    );
    await expect(
      preview.execute({
        serviceId: "atlas-api",
        policy: { mode: "not-a-real-mode" },
        startsAt: "2026-08-03T21:00:00.000Z",
        endsAt: "2026-08-04T12:00:00.000Z",
      }),
    ).rejects.toThrow(ServiceAvailabilityModeValidationError);
  });

  it("applies an active override to the candidate policy's evaluation", async () => {
    const preview = new PreviewRegisteredServiceAvailabilityPolicy(
      catalog(),
      overrideStore({
        kind: "suspend_schedule",
        expiresAt: "2026-08-05T00:00:00.000Z",
      }),
    );
    const result = await preview.execute({
      serviceId: "atlas-api",
      policy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "00:00", end: "23:59" }],
      },
      startsAt: "2026-08-03T21:00:00.000Z",
      endsAt: "2026-08-04T12:00:00.000Z",
    });
    expect(result.outcome).toBe("not_required");
  });
});
