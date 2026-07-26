import { describe, expect, it, vi } from "vitest";

import {
  createServiceAvailabilityOverride,
  isSameServiceAvailabilityOverride,
  SERVICE_AVAILABILITY_OVERRIDE_KINDS,
  type ServiceAvailabilityOverride,
} from "../../../src/service-scheduling/domain/service-availability-override.js";
import { ServiceAvailabilityOverrideValidationError } from "../../../src/service-scheduling/domain/service-availability-override-validation-error.js";

const referenceInstant = new Date("2026-08-01T12:00:00.000Z");
const canonicalExpiration = "2026-08-01T13:00:00.000Z";

function createFromRuntimeValues(
  input: unknown,
  reference: unknown,
): ServiceAvailabilityOverride {
  return createServiceAvailabilityOverride(input, reference as Date);
}

function expectValidationError(
  input: unknown,
  code: ServiceAvailabilityOverrideValidationError["code"],
  ...referenceArguments: [] | [unknown]
): void {
  const suppliedReference =
    referenceArguments.length === 0 ? referenceInstant : referenceArguments[0];

  expect(() => createFromRuntimeValues(input, suppliedReference)).toThrowError(
    expect.objectContaining({
      name: "ServiceAvailabilityOverrideValidationError",
      code,
      message: `Invalid service availability override: ${code}`,
    }),
  );
}

describe("ServiceAvailabilityOverride", () => {
  it("defines exactly the frozen canonical override kinds", () => {
    expect(SERVICE_AVAILABILITY_OVERRIDE_KINDS).toEqual([
      "keep_available",
      "suspend_schedule",
    ]);
    expect(Object.isFrozen(SERVICE_AVAILABILITY_OVERRIDE_KINDS)).toBe(true);
  });

  it.each(SERVICE_AVAILABILITY_OVERRIDE_KINDS)(
    "creates a canonical frozen %s override",
    (kind) => {
      const input = { kind, expiresAt: canonicalExpiration };
      const override = createServiceAvailabilityOverride(
        input,
        referenceInstant,
      );

      expect(override).toEqual({ kind, expiresAt: canonicalExpiration });
      expect(Object.keys(override)).toEqual(["kind", "expiresAt"]);
      expect(override).not.toBe(input);
      expect(Object.isFrozen(override)).toBe(true);
    },
  );

  it("creates equal domain values from equal inputs", () => {
    const input = {
      kind: "keep_available",
      expiresAt: canonicalExpiration,
    };

    expect(createServiceAvailabilityOverride(input, referenceInstant)).toEqual(
      createServiceAvailabilityOverride(input, referenceInstant),
    );
  });

  it("compares canonical override values without using identity or time", () => {
    const first = createServiceAvailabilityOverride(
      { kind: "keep_available", expiresAt: canonicalExpiration },
      referenceInstant,
    );
    const equal = createServiceAvailabilityOverride(
      { expiresAt: canonicalExpiration, kind: "keep_available" },
      referenceInstant,
    );
    const differentKind = createServiceAvailabilityOverride(
      { kind: "suspend_schedule", expiresAt: canonicalExpiration },
      referenceInstant,
    );
    const differentExpiration = createServiceAvailabilityOverride(
      {
        kind: "keep_available",
        expiresAt: "2026-08-01T14:00:00.000Z",
      },
      referenceInstant,
    );
    const dateNowSpy = vi.spyOn(Date, "now");

    try {
      expect(isSameServiceAvailabilityOverride(first, first)).toBe(true);
      expect(first).not.toBe(equal);
      expect(isSameServiceAvailabilityOverride(first, equal)).toBe(true);
      expect(isSameServiceAvailabilityOverride(first, differentKind)).toBe(
        false,
      );
      expect(
        isSameServiceAvailabilityOverride(first, differentExpiration),
      ).toBe(false);
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(first).toEqual({
        kind: "keep_available",
        expiresAt: canonicalExpiration,
      });
      expect(equal).toEqual(first);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it.each([
    undefined,
    null,
    "keep_available",
    1,
    true,
    [],
    (): object => ({}),
    new Date(canonicalExpiration),
    {},
    { kind: "keep_available" },
    { expiresAt: canonicalExpiration },
    {
      kind: "keep_available",
      expiresAt: canonicalExpiration,
      serviceId: "sentinel-private-service",
    },
    {
      kind: "suspend_schedule",
      expiresAt: canonicalExpiration,
      reason: "sentinel-private-reason",
    },
  ])("rejects invalid override shape %#", (input) => {
    expectValidationError(input, "invalid_service_availability_override");
  });

  it("rejects inherited required fields and own symbol properties", () => {
    expectValidationError(
      Object.assign(Object.create({ kind: "keep_available" }), {
        expiresAt: canonicalExpiration,
      }),
      "invalid_service_availability_override",
    );
    expectValidationError(
      Object.assign(Object.create({ expiresAt: canonicalExpiration }), {
        kind: "keep_available",
      }),
      "invalid_service_availability_override",
    );
    expectValidationError(
      {
        kind: "keep_available",
        expiresAt: canonicalExpiration,
        [Symbol("sentinel-private-metadata")]: true,
      },
      "invalid_service_availability_override",
    );
  });

  it.each([
    "KEEP_AVAILABLE",
    "KeepAvailable",
    "keep-available",
    "keep available",
    " keep_available",
    "keep_available ",
    "suspend",
    "pause_schedule",
    "manual",
    "disabled",
    "available",
    "unavailable",
    "",
    " ",
    new String("keep_available"),
    null,
    undefined,
    1,
  ])("rejects invalid override kind %#", (kind) => {
    expectValidationError(
      { kind, expiresAt: canonicalExpiration },
      "invalid_service_availability_override_kind",
    );
  });

  it.each([
    "2026-08-01T12:00:00.001Z",
    "2026-08-01T12:00:01.000Z",
    "2026-08-04T12:00:00.000Z",
    "2028-02-29T12:00:00.000Z",
  ])("accepts canonical future expiration %s", (expiresAt) => {
    expect(
      createServiceAvailabilityOverride(
        { kind: "keep_available", expiresAt },
        referenceInstant,
      ).expiresAt,
    ).toBe(expiresAt);
  });

  it.each([
    "invalid",
    "2026-02-30T12:00:00.000Z",
    "2026-08-01",
    "2026-08-01T12:00:00Z",
    "2026-08-01T12:00:00.000-03:00",
    "2026-08-01T12:00:00",
    "2026-08-01 12:00:00",
    " 2026-08-01T13:00:00.000Z",
    "2026-08-01T13:00:00.000Z ",
    1_786_102_800_000,
    new Date(canonicalExpiration),
    null,
    undefined,
    new String(canonicalExpiration),
  ])("rejects non-canonical expiration %#", (expiresAt) => {
    expectValidationError(
      { kind: "keep_available", expiresAt },
      "invalid_service_availability_override_expiration",
    );
  });

  it.each([
    undefined,
    null,
    "2026-08-01T12:00:00.000Z",
    1_786_102_400_000,
    {},
    [],
    new Date(Number.NaN),
    new Date("invalid"),
  ])("rejects invalid reference instant %#", (reference) => {
    expectValidationError(
      { kind: "keep_available", expiresAt: canonicalExpiration },
      "invalid_service_availability_override_reference_instant",
      reference,
    );
  });

  it.each([
    "2026-08-01T12:00:00.000Z",
    "2026-08-01T11:59:59.999Z",
    "2025-01-01T00:00:00.000Z",
  ])("rejects non-future expiration %s", (expiresAt) => {
    expectValidationError(
      { kind: "keep_available", expiresAt },
      "non_future_service_availability_override_expiration",
    );
  });

  it("accepts an expiration exactly one millisecond later", () => {
    expect(
      createServiceAvailabilityOverride(
        {
          kind: "suspend_schedule",
          expiresAt: "2026-08-01T12:00:00.001Z",
        },
        referenceInstant,
      ),
    ).toEqual({
      kind: "suspend_schedule",
      expiresAt: "2026-08-01T12:00:00.001Z",
    });
  });

  it("does not retain mutable source input or the reference Date", () => {
    const input = {
      kind: "keep_available",
      expiresAt: canonicalExpiration,
    };
    const reference = new Date(referenceInstant);
    const override = createServiceAvailabilityOverride(input, reference);

    input.kind = "suspend_schedule";
    input.expiresAt = "2027-01-01T00:00:00.000Z";
    reference.setUTCFullYear(2030);

    expect(override).toEqual({
      kind: "keep_available",
      expiresAt: canonicalExpiration,
    });
    expect(override).not.toHaveProperty("referenceInstant");
    expect(override).not.toHaveProperty("cancel");
    expect(override).not.toHaveProperty("extend");
    expect(override).not.toHaveProperty("setKind");
  });

  it("prevents mutation of the canonical override", () => {
    const override = createServiceAvailabilityOverride(
      {
        kind: "keep_available",
        expiresAt: canonicalExpiration,
      },
      referenceInstant,
    );
    const mutableView = override as unknown as Record<string, unknown>;

    expect(() => {
      mutableView["kind"] = "suspend_schedule";
    }).toThrow(TypeError);
    expect(() => {
      mutableView["serviceId"] = "sentinel-private-service";
    }).toThrow(TypeError);
    expect(override.kind).toBe("keep_available");
  });

  it("reads the valid reference timestamp exactly once", () => {
    let getTimeCalls = 0;

    class ObservableDate extends Date {
      public override getTime(): number {
        getTimeCalls += 1;
        return super.getTime();
      }
    }

    const reference = new ObservableDate(referenceInstant);

    createServiceAvailabilityOverride(
      { kind: "keep_available", expiresAt: canonicalExpiration },
      reference,
    );

    expect(getTimeCalls).toBe(1);
  });

  it.each([
    [
      {
        kind: "sentinel-private-kind",
        expiresAt: canonicalExpiration,
      },
      "invalid_service_availability_override_kind",
    ],
    [
      {
        kind: "keep_available",
        expiresAt: "sentinel-private-expiration",
      },
      "invalid_service_availability_override_expiration",
    ],
    [
      {
        kind: "keep_available",
        expiresAt: canonicalExpiration,
        serviceId: "sentinel-private-service",
      },
      "invalid_service_availability_override",
    ],
  ] as const)("does not expose rejected values for %s", (input, code) => {
    try {
      createServiceAvailabilityOverride(input, referenceInstant);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceAvailabilityOverrideValidationError);
      expect(error).toMatchObject({ code });
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("input");
      expect(error).not.toHaveProperty("referenceInstant");

      for (const sentinel of [
        "sentinel-private-kind",
        "sentinel-private-expiration",
        "sentinel-private-service",
        referenceInstant.toISOString(),
      ]) {
        expect(String(error)).not.toContain(sentinel);
        expect(Object.values(error as object)).not.toContain(sentinel);
      }
    }
  });

  it("uses no implicit clock, timer, or process listener", () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      createServiceAvailabilityOverride(
        { kind: "keep_available", expiresAt: canonicalExpiration },
        referenceInstant,
      );

      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
