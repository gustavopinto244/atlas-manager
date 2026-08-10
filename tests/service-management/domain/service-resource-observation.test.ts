import { describe, expect, it } from "vitest";

import {
  createAvailableServiceResourceObservation,
  createUnavailableServiceResourceObservation,
  ServiceResourceObservationValidationError,
} from "../../../src/service-management/domain/service-resource-observation.js";

const OBSERVED_AT = "2026-01-01T00:00:00.000Z";

describe("createAvailableServiceResourceObservation", () => {
  it("accepts a fully available observation", () => {
    const observation = createAvailableServiceResourceObservation({
      observedAt: OBSERVED_AT,
      cpu: { outcome: "available", usagePercent: 12.5 },
      memory: {
        outcome: "available",
        usageBytes: 1024,
        limitBytes: 4096,
        usagePercent: 25,
      },
      uptimeSeconds: 3600,
    });
    expect(observation).toEqual({
      outcome: "available",
      observedAt: OBSERVED_AT,
      cpu: { outcome: "available", usagePercent: 12.5 },
      memory: {
        outcome: "available",
        usageBytes: 1024,
        limitBytes: 4096,
        usagePercent: 25,
      },
      uptimeSeconds: 3600,
    });
  });

  it("preserves a null memory limit rather than coercing it to zero", () => {
    const observation = createAvailableServiceResourceObservation({
      observedAt: OBSERVED_AT,
      cpu: { outcome: "available", usagePercent: 1 },
      memory: {
        outcome: "available",
        usageBytes: 512,
        limitBytes: null,
        usagePercent: null,
      },
      uptimeSeconds: null,
    });
    expect(observation).toMatchObject({
      memory: { limitBytes: null, usagePercent: null },
      uptimeSeconds: null,
    });
  });

  it("allows cpu or memory to independently report unavailable", () => {
    const observation = createAvailableServiceResourceObservation({
      observedAt: OBSERVED_AT,
      cpu: { outcome: "unavailable", reason: "unsupported" },
      memory: {
        outcome: "available",
        usageBytes: 10,
        limitBytes: null,
        usagePercent: null,
      },
      uptimeSeconds: null,
    });
    expect(observation).toMatchObject({
      cpu: { outcome: "unavailable", reason: "unsupported" },
    });
  });

  it.each([["not-a-date"], [""]])(
    "rejects an invalid observedAt %s",
    (observedAt) => {
      expect(() =>
        createAvailableServiceResourceObservation({
          observedAt,
          cpu: { outcome: "available", usagePercent: 1 },
          memory: {
            outcome: "available",
            usageBytes: 1,
            limitBytes: null,
            usagePercent: null,
          },
          uptimeSeconds: null,
        }),
      ).toThrow(ServiceResourceObservationValidationError);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-finite or negative cpu usagePercent %s",
    (usagePercent) => {
      expect(() =>
        createAvailableServiceResourceObservation({
          observedAt: OBSERVED_AT,
          cpu: { outcome: "available", usagePercent },
          memory: {
            outcome: "available",
            usageBytes: 1,
            limitBytes: null,
            usagePercent: null,
          },
          uptimeSeconds: null,
        }),
      ).toThrow(ServiceResourceObservationValidationError);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-finite or negative memory usageBytes %s",
    (usageBytes) => {
      expect(() =>
        createAvailableServiceResourceObservation({
          observedAt: OBSERVED_AT,
          cpu: { outcome: "available", usagePercent: 1 },
          memory: {
            outcome: "available",
            usageBytes,
            limitBytes: null,
            usagePercent: null,
          },
          uptimeSeconds: null,
        }),
      ).toThrow(ServiceResourceObservationValidationError);
    },
  );

  it("rejects a negative uptimeSeconds", () => {
    expect(() =>
      createAvailableServiceResourceObservation({
        observedAt: OBSERVED_AT,
        cpu: { outcome: "available", usagePercent: 1 },
        memory: {
          outcome: "available",
          usageBytes: 1,
          limitBytes: null,
          usagePercent: null,
        },
        uptimeSeconds: -1,
      }),
    ).toThrow(ServiceResourceObservationValidationError);
  });
});

describe("createUnavailableServiceResourceObservation", () => {
  it("creates a stable unavailable observation", () => {
    expect(
      createUnavailableServiceResourceObservation(OBSERVED_AT, "timeout"),
    ).toEqual({
      outcome: "unavailable",
      observedAt: OBSERVED_AT,
      reason: "timeout",
    });
  });

  it("rejects an invalid observedAt", () => {
    expect(() =>
      createUnavailableServiceResourceObservation("not-a-date", "unavailable"),
    ).toThrow(ServiceResourceObservationValidationError);
  });
});
