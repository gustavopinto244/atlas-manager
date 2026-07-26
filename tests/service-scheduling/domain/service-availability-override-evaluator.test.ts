import { describe, expect, it, vi } from "vitest";

import { ServiceAvailabilityEvaluationError } from "../../../src/service-scheduling/domain/service-availability-evaluation-error.js";
import {
  evaluateServiceAvailabilityWithOverride,
  isServiceAvailabilityOverrideExpiredAt,
} from "../../../src/service-scheduling/domain/service-availability-override-evaluator.js";
import {
  createServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../../src/service-scheduling/domain/service-availability-override.js";
import {
  createServiceAvailabilityPolicy,
  type ServiceAvailabilityPolicy,
} from "../../../src/service-scheduling/domain/service-availability-policy.js";

const evaluationInstant = new Date("2026-08-03T12:00:00.000Z");
const overrideCreationInstant = new Date("2026-08-03T10:00:00.000Z");

function createPolicy(
  mode: "always" | "manual" | "disabled",
): ServiceAvailabilityPolicy {
  return createServiceAvailabilityPolicy({ mode });
}

function createScheduledPolicy(
  windows: readonly {
    readonly weekday: string;
    readonly start: string;
    readonly end: string;
  }[] = [{ weekday: "monday", start: "09:00", end: "10:00" }],
): ServiceAvailabilityPolicy {
  return createServiceAvailabilityPolicy({
    mode: "scheduled",
    timezone: "America/Sao_Paulo",
    windows,
  });
}

function createOverride(
  kind: "keep_available" | "suspend_schedule",
  expiresAt = "2026-08-03T12:00:00.001Z",
): ServiceAvailabilityOverride {
  return createServiceAvailabilityOverride(
    { kind, expiresAt },
    overrideCreationInstant,
  );
}

function evaluateRuntimeInstant(
  policy: ServiceAvailabilityPolicy,
  override: ServiceAvailabilityOverride | null,
  instant: unknown,
): void {
  evaluateServiceAvailabilityWithOverride(policy, override, instant as Date);
}

describe("isServiceAvailabilityOverrideExpiredAt", () => {
  it.each(["keep_available", "suspend_schedule"] as const)(
    "uses the inclusive expiration boundary for %s",
    (kind) => {
      const override = createOverride(kind, "2026-08-03T12:00:00.000Z");

      expect(
        isServiceAvailabilityOverrideExpiredAt(
          override,
          new Date("2026-08-03T11:59:59.999Z"),
        ),
      ).toBe(false);
      expect(
        isServiceAvailabilityOverrideExpiredAt(
          override,
          new Date("2026-08-03T12:00:00.000Z"),
        ),
      ).toBe(true);
      expect(
        isServiceAvailabilityOverrideExpiredAt(
          override,
          new Date("2026-08-03T12:00:00.001Z"),
        ),
      ).toBe(true);
    },
  );

  it.each([
    undefined,
    null,
    "2026-08-03T12:00:00.000Z",
    0,
    {},
    [],
    new Date(Number.NaN),
  ])("preserves safe invalid-instant errors for %#", (instant) => {
    expect(() =>
      isServiceAvailabilityOverrideExpiredAt(
        createOverride("keep_available"),
        instant as Date,
      ),
    ).toThrowError(
      expect.objectContaining({
        name: "ServiceAvailabilityEvaluationError",
        code: "invalid_service_availability_instant",
        message: "Invalid service availability instant",
      }),
    );
  });
});

describe("evaluateServiceAvailabilityWithOverride", () => {
  it.each([
    ["always", "available"],
    ["manual", "manual"],
    ["disabled", "disabled"],
  ] as const)(
    "delegates %s with no override to the base expectation %s",
    (mode, expectation) => {
      expect(
        evaluateServiceAvailabilityWithOverride(
          createPolicy(mode),
          null,
          evaluationInstant,
        ),
      ).toBe(expectation);
    },
  );

  it.each([
    ["2026-08-03T12:00:00.000Z", "available"],
    ["2026-08-03T13:00:00.000Z", "unavailable"],
  ] as const)(
    "preserves scheduled base evaluation without an override at %s",
    (instant, expectation) => {
      expect(
        evaluateServiceAvailabilityWithOverride(
          createScheduledPolicy(),
          null,
          new Date(instant),
        ),
      ).toBe(expectation);
    },
  );

  it("preserves timezone-aware weekday conversion in base fallback", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "22:00", end: "23:00" },
    ]);

    expect(
      evaluateServiceAvailabilityWithOverride(
        policy,
        null,
        new Date("2026-08-04T01:30:00.000Z"),
      ),
    ).toBe("available");
  });

  it.each([
    ["keep_available", "always", "available"],
    ["keep_available", "scheduled", "available"],
    ["keep_available", "manual", "available"],
    ["keep_available", "disabled", "disabled"],
    ["suspend_schedule", "always", "manual"],
    ["suspend_schedule", "scheduled", "manual"],
    ["suspend_schedule", "manual", "manual"],
    ["suspend_schedule", "disabled", "disabled"],
  ] as const)("applies active %s to %s as %s", (kind, mode, expectation) => {
    const policy =
      mode === "scheduled" ? createScheduledPolicy() : createPolicy(mode);

    expect(
      evaluateServiceAvailabilityWithOverride(
        policy,
        createOverride(kind),
        evaluationInstant,
      ),
    ).toBe(expectation);
  });

  it.each(["keep_available", "suspend_schedule"] as const)(
    "does not perform scheduled timezone conversion for active %s",
    (kind) => {
      const formatToPartsSpy = vi.spyOn(
        Intl.DateTimeFormat.prototype,
        "formatToParts",
      );

      try {
        evaluateServiceAvailabilityWithOverride(
          createScheduledPolicy(),
          createOverride(kind),
          evaluationInstant,
        );

        expect(formatToPartsSpy).not.toHaveBeenCalled();
      } finally {
        formatToPartsSpy.mockRestore();
      }
    },
  );

  it.each([
    ["keep_available", "2026-08-03T11:59:59.999Z", "available"],
    ["keep_available", "2026-08-03T12:00:00.000Z", "unavailable"],
    ["keep_available", "2026-08-03T12:00:00.001Z", "unavailable"],
    ["suspend_schedule", "2026-08-03T11:59:59.999Z", "manual"],
    ["suspend_schedule", "2026-08-03T12:00:00.000Z", "unavailable"],
    ["suspend_schedule", "2026-08-03T12:00:00.001Z", "unavailable"],
  ] as const)(
    "evaluates %s at expiration boundary %s as %s",
    (kind, instant, expectation) => {
      const override = createOverride(kind, "2026-08-03T12:00:00.000Z");

      expect(
        evaluateServiceAvailabilityWithOverride(
          createScheduledPolicy([
            { weekday: "monday", start: "10:00", end: "11:00" },
          ]),
          override,
          new Date(instant),
        ),
      ).toBe(expectation);
    },
  );

  it.each(["keep_available", "suspend_schedule"] as const)(
    "delegates an expired %s to timezone-aware base evaluation",
    (kind) => {
      const policy = createScheduledPolicy([
        { weekday: "monday", start: "22:00", end: "23:00" },
      ]);
      const override = createOverride(kind, "2026-08-04T01:00:00.000Z");

      expect(
        evaluateServiceAvailabilityWithOverride(
          policy,
          override,
          new Date("2026-08-04T01:30:00.000Z"),
        ),
      ).toBe("available");
    },
  );

  it.each(["keep_available", "suspend_schedule"] as const)(
    "keeps disabled at highest precedence for active and expired %s",
    (kind) => {
      const policy = createPolicy("disabled");

      expect(
        evaluateServiceAvailabilityWithOverride(
          policy,
          createOverride(kind),
          evaluationInstant,
        ),
      ).toBe("disabled");
      expect(
        evaluateServiceAvailabilityWithOverride(
          policy,
          createOverride(kind, "2026-08-03T11:00:00.000Z"),
          evaluationInstant,
        ),
      ).toBe("disabled");
    },
  );

  it.each([
    undefined,
    null,
    "2026-08-03T12:00:00.000Z",
    0,
    {},
    [],
    new Date(Number.NaN),
    new Date("invalid"),
  ])("rejects invalid evaluation instant %#", (instant) => {
    expect(() =>
      evaluateRuntimeInstant(
        createPolicy("disabled"),
        createOverride("keep_available"),
        instant,
      ),
    ).toThrowError(
      expect.objectContaining({
        name: "ServiceAvailabilityEvaluationError",
        code: "invalid_service_availability_instant",
        message: "Invalid service availability instant",
      }),
    );
  });

  it("keeps invalid-instant errors free of inputs", () => {
    const policy = createScheduledPolicy();
    const override = createOverride(
      "keep_available",
      "2026-08-03T12:00:00.001Z",
    );
    const rejectedInstant = "sentinel-private-evaluation-instant";

    try {
      evaluateRuntimeInstant(policy, override, rejectedInstant);
      throw new Error("Expected evaluation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceAvailabilityEvaluationError);
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("policy");
      expect(error).not.toHaveProperty("override");
      expect(error).not.toHaveProperty("instant");
      expect(String(error)).not.toContain(rejectedInstant);
      expect(String(error)).not.toContain(override.expiresAt);
      expect(Object.values(error as object)).not.toContain(rejectedInstant);
    }
  });

  it("reads the caller timestamp once and leaves every input unchanged", () => {
    let getTimeCalls = 0;

    class ObservableDate extends Date {
      public override getTime(): number {
        getTimeCalls += 1;
        return super.getTime();
      }
    }

    const instant = new ObservableDate(evaluationInstant);
    const originalTimestamp = Date.prototype.getTime.call(instant);
    const policy = createScheduledPolicy();
    const override = createOverride("keep_available");
    const originalPolicy = structuredClone(policy);
    const originalOverride = structuredClone(override);
    const result = evaluateServiceAvailabilityWithOverride(
      policy,
      override,
      instant,
    );

    expect(result).toBe("available");
    expect(typeof result).toBe("string");
    expect(getTimeCalls).toBe(1);
    expect(Date.prototype.getTime.call(instant)).toBe(originalTimestamp);
    expect(policy).toEqual(originalPolicy);
    expect(override).toEqual(originalOverride);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(override)).toBe(true);
    expect(result).not.toBe(policy);
    expect(result).not.toBe(override);
  });

  it("uses no implicit clock, timer, or process listener", () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      evaluateServiceAvailabilityWithOverride(
        createScheduledPolicy(),
        createOverride("suspend_schedule"),
        evaluationInstant,
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
