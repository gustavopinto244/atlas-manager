import { describe, expect, it, vi } from "vitest";

import { GenerateRegisteredServiceAvailabilityReconciliationOccurrences } from "../../../src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import { RegisteredServiceNotFoundError } from "../../../src/service-management/application/registered-service-not-found-error.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { ServiceAvailabilityTransitionCalculationError } from "../../../src/service-scheduling/domain/service-availability-transition-calculation-error.js";

const timezone = "America/Sao_Paulo";

function createService(
  availabilityPolicy: unknown,
  supportedOperations: readonly string[] = ["readStatus", "start", "stop"],
): RegisteredService {
  return RegisteredService.create({
    id: "atlas-api",
    displayName: "Atlas API",
    managementAdapter: "pm2",
    externalResourceId: "atlas-api-process",
    supportedOperations,
    availabilityPolicy,
  });
}

function createCatalog(
  findById: RegisteredServiceCatalog["findById"],
): RegisteredServiceCatalog {
  return {
    findById,
    list: vi.fn(),
  };
}

function createScheduledService(
  windows: readonly {
    readonly weekday: string;
    readonly start: string;
    readonly end: string;
  }[],
  supportedOperations?: readonly string[],
): RegisteredService {
  return createService(
    {
      mode: "scheduled",
      timezone,
      windows,
    },
    supportedOperations,
  );
}

describe("GenerateRegisteredServiceAvailabilityReconciliationOccurrences", () => {
  it("resolves the exact service ID once and uses the catalog-owned policy", async () => {
    const service = createScheduledService([
      { weekday: "monday", start: "09:00", end: "17:00" },
    ]);
    const findById = vi.fn(() => Promise.resolve(service));
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(findById),
      );

    const result = await generator.execute(
      "atlas-api",
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect(findById).toHaveBeenCalledTimes(1);
    expect(findById).toHaveBeenCalledWith("atlas-api");
    expect(result).toEqual([
      {
        serviceId: "atlas-api",
        operation: "start",
        scheduledFor: "2026-07-27T12:00:00.000Z",
      },
    ]);
  });

  it("does not normalize the caller-supplied service ID", async () => {
    const findById = vi.fn(() => Promise.resolve(null));
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(findById),
      );

    await expect(
      generator.execute(
        " Atlas-API ",
        new Date("2026-07-27T11:00:00.000Z"),
        new Date("2026-07-27T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(RegisteredServiceNotFoundError);
    expect(findById).toHaveBeenCalledWith(" Atlas-API ");
  });

  it("propagates catalog failures by identity without retrying", async () => {
    const sentinel = new Error("catalog sentinel");
    const findById = vi.fn(() => Promise.reject(sentinel));
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(findById),
      );

    await expect(
      generator.execute(
        "atlas-api",
        new Date("2026-07-27T11:00:00.000Z"),
        new Date("2026-07-27T12:00:00.000Z"),
      ),
    ).rejects.toBe(sentinel);
    expect(findById).toHaveBeenCalledTimes(1);
  });

  it.each(["always", "manual", "disabled"] as const)(
    "returns an empty frozen array for a %s policy",
    async (mode) => {
      const generator =
        new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
          createCatalog(() => Promise.resolve(createService({ mode }))),
        );

      const result = await generator.execute(
        "atlas-api",
        new Date("2026-07-27T11:00:00.000Z"),
        new Date("2026-07-28T11:00:00.000Z"),
      );

      expect(result).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it("maps a complete window to ordered canonical start and stop occurrences", async () => {
    const service = createScheduledService([
      { weekday: "monday", start: "09:00", end: "17:00" },
    ]);
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(() => Promise.resolve(service)),
      );

    const result = await generator.execute(
      "atlas-api",
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T20:00:00.000Z"),
    );

    expect(result).toEqual([
      {
        serviceId: "atlas-api",
        operation: "start",
        scheduledFor: "2026-07-27T12:00:00.000Z",
      },
      {
        serviceId: "atlas-api",
        operation: "stop",
        scheduledFor: "2026-07-27T20:00:00.000Z",
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
    expect(result.map(Object.keys)).toEqual([
      ["serviceId", "operation", "scheduledFor"],
      ["serviceId", "operation", "scheduledFor"],
    ]);
  });

  it("does not synthesize occurrences between adjacent windows", async () => {
    const service = createScheduledService([
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "12:00", end: "17:00" },
    ]);
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(() => Promise.resolve(service)),
      );

    const result = await generator.execute(
      "atlas-api",
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T20:00:00.000Z"),
    );

    expect(
      result.map(({ operation, scheduledFor }) => ({
        operation,
        scheduledFor,
      })),
    ).toEqual([
      { operation: "start", scheduledFor: "2026-07-27T12:00:00.000Z" },
      { operation: "stop", scheduledFor: "2026-07-27T20:00:00.000Z" },
    ]);
  });

  it("preserves exclusive-lower and inclusive-upper interval semantics", async () => {
    const service = createScheduledService([
      { weekday: "monday", start: "09:00", end: "17:00" },
    ]);
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(() => Promise.resolve(service)),
      );

    const result = await generator.execute(
      "atlas-api",
      new Date("2026-07-27T12:00:00.000Z"),
      new Date("2026-07-27T20:00:00.000Z"),
    );

    expect(result).toEqual([
      {
        serviceId: "atlas-api",
        operation: "stop",
        scheduledFor: "2026-07-27T20:00:00.000Z",
      },
    ]);
  });

  it("maps multiple windows without filtering unsupported operations", async () => {
    const service = createScheduledService(
      [
        { weekday: "monday", start: "09:00", end: "12:00" },
        { weekday: "monday", start: "13:00", end: "17:00" },
      ],
      ["readStatus"],
    );
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(() => Promise.resolve(service)),
      );

    const result = await generator.execute(
      "atlas-api",
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T20:00:00.000Z"),
    );

    expect(result.map((occurrence) => occurrence.operation)).toEqual([
      "start",
      "stop",
      "start",
      "stop",
    ]);
  });

  it("propagates transition interval errors unchanged", async () => {
    const service = createService({ mode: "always" });
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(() => Promise.resolve(service)),
      );

    let receivedError: unknown;
    try {
      await generator.execute(
        "atlas-api",
        new Date("2026-07-27T11:00:01.000Z"),
        new Date("2026-07-27T12:00:00.000Z"),
      );
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toBeInstanceOf(
      ServiceAvailabilityTransitionCalculationError,
    );
    expect(receivedError).toMatchObject({
      code: "transition_interval_not_minute_aligned",
    });
  });

  it("does not mutate or freeze its inputs", async () => {
    const service = createScheduledService([
      { weekday: "monday", start: "09:00", end: "17:00" },
    ]);
    const fromExclusive = new Date("2026-07-27T11:00:00.000Z");
    const toInclusive = new Date("2026-07-27T12:00:00.000Z");
    const fromTimestamp = fromExclusive.getTime();
    const toTimestamp = toInclusive.getTime();
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(() => Promise.resolve(service)),
      );

    await generator.execute("atlas-api", fromExclusive, toInclusive);

    expect(fromExclusive.getTime()).toBe(fromTimestamp);
    expect(toInclusive.getTime()).toBe(toTimestamp);
    expect(Object.isFrozen(fromExclusive)).toBe(false);
    expect(Object.isFrozen(toInclusive)).toBe(false);
  });

  it("does not read current time or create timers", async () => {
    const dateNow = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const generator =
      new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(
        createCatalog(() => Promise.resolve(createService({ mode: "manual" }))),
      );

    await generator.execute(
      "atlas-api",
      new Date("2026-07-27T11:00:00.000Z"),
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect(dateNow).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });
});
