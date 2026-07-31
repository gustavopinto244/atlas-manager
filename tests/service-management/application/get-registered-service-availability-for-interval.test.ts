import { describe, expect, it, vi } from "vitest";
import { GetRegisteredServiceAvailabilityForInterval } from "../../../src/service-management/application/get-registered-service-availability-for-interval.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";

const service = RegisteredService.create({
  id: "atlas-api",
  displayName: "Atlas API",
  managementAdapter: "mock",
  externalResourceId: "atlas-api",
  supportedOperations: ["readStatus"],
  availabilityPolicy: { mode: "always" },
});
describe("get registered service availability for interval", () => {
  it("reads override once, uses exact interval, and does not read a clock", async () => {
    const catalog = {
      list: vi.fn(async () => [service]),
      findById: vi.fn(async () => service),
    };
    const overrideStore = {
      findByServiceId: vi.fn(async () => null),
      save: vi.fn(),
      removeByServiceId: vi.fn(),
      removeByServiceIdIfMatches: vi.fn(),
    };
    const query = new GetRegisteredServiceAvailabilityForInterval(
      catalog,
      overrideStore,
    );
    await expect(
      query.execute({
        serviceId: "atlas-api",
        startsAt: "2026-08-03T21:00:00.000Z",
        endsAt: "2026-08-04T12:00:00.000Z",
      }),
    ).resolves.toEqual({
      serviceId: "atlas-api",
      startsAt: "2026-08-03T21:00:00.000Z",
      endsAt: "2026-08-04T12:00:00.000Z",
      outcome: "required",
      firstRequiredAt: "2026-08-03T21:00:00.000Z",
    });
    expect(catalog.findById).toHaveBeenCalledOnce();
    expect(overrideStore.findByServiceId).toHaveBeenCalledOnce();
  });
});
