import { describe, expect, it, vi } from "vitest";

import {
  SERVICE_AVAILABILITY_EXPECTATIONS,
  evaluateServiceAvailabilityPolicy,
} from "../../../src/service-scheduling/domain/service-availability-policy-evaluator.js";
import { ServiceAvailabilityEvaluationError } from "../../../src/service-scheduling/domain/service-availability-evaluation-error.js";
import {
  createServiceAvailabilityPolicy,
  type ServiceAvailabilityPolicy,
} from "../../../src/service-scheduling/domain/service-availability-policy.js";

const timezone = "America/Sao_Paulo";

function createNonScheduledPolicy(
  mode: "always" | "manual" | "disabled",
): ServiceAvailabilityPolicy {
  return createServiceAvailabilityPolicy({ mode });
}

function createScheduledPolicy(
  windows: readonly {
    readonly weekday: string;
    readonly start: string;
    readonly end: string;
  }[],
): ServiceAvailabilityPolicy {
  return createServiceAvailabilityPolicy({
    mode: "scheduled",
    timezone,
    windows,
  });
}

function evaluateRuntimeInstant(
  policy: ServiceAvailabilityPolicy,
  instant: unknown,
): void {
  evaluateServiceAvailabilityPolicy(policy, instant as Date);
}

describe("evaluateServiceAvailabilityPolicy", () => {
  it("defines exactly the canonical expectation vocabulary", () => {
    expect(SERVICE_AVAILABILITY_EXPECTATIONS).toEqual([
      "available",
      "unavailable",
      "manual",
      "disabled",
    ]);
    expect(Object.isFrozen(SERVICE_AVAILABILITY_EXPECTATIONS)).toBe(true);
  });

  it.each([
    ["always", "available"],
    ["manual", "manual"],
    ["disabled", "disabled"],
  ] as const)(
    "evaluates %s independently from weekday and local time",
    (mode, expectation) => {
      const policy = createNonScheduledPolicy(mode);

      expect(
        evaluateServiceAvailabilityPolicy(
          policy,
          new Date("2026-07-27T03:00:00.000Z"),
        ),
      ).toBe(expectation);
      expect(
        evaluateServiceAvailabilityPolicy(
          policy,
          new Date("2026-08-02T23:59:59.999Z"),
        ),
      ).toBe(expectation);
    },
  );

  it.each(["always", "manual", "disabled"] as const)(
    "does not perform timezone conversion for %s",
    (mode) => {
      const formatterSpy = vi.spyOn(Intl, "DateTimeFormat");

      try {
        evaluateServiceAvailabilityPolicy(
          createNonScheduledPolicy(mode),
          new Date("2026-07-27T12:00:00.000Z"),
        );

        expect(formatterSpy).not.toHaveBeenCalled();
      } finally {
        formatterSpy.mockRestore();
      }
    },
  );

  it.each([
    ["2026-07-27T12:00:00.000Z", "available"],
    ["2026-07-27T12:00:01.000Z", "available"],
    ["2026-07-27T12:00:59.999Z", "available"],
    ["2026-07-27T15:30:00.000Z", "available"],
    ["2026-07-27T19:59:59.999Z", "available"],
    ["2026-07-27T20:00:00.000Z", "unavailable"],
  ] as const)(
    "evaluates minute-precision boundary %s as %s",
    (instant, expectation) => {
      const policy = createScheduledPolicy([
        { weekday: "monday", start: "09:00", end: "17:00" },
      ]);

      expect(evaluateServiceAvailabilityPolicy(policy, new Date(instant))).toBe(
        expectation,
      );
    },
  );

  it.each([
    ["2026-07-27T11:59:59.999Z", "unavailable"],
    ["2026-07-27T20:01:00.000Z", "unavailable"],
    ["2026-07-27T16:00:00.000Z", "unavailable"],
    ["2026-07-28T12:00:00.000Z", "unavailable"],
  ] as const)("evaluates outside instant %s as %s", (instant, expectation) => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "14:00", end: "17:00" },
      { weekday: "friday", start: "09:00", end: "17:00" },
    ]);

    expect(evaluateServiceAvailabilityPolicy(policy, new Date(instant))).toBe(
      expectation,
    );
  });

  it.each([
    ["2026-07-27T14:59:00.000Z", "available"],
    ["2026-07-27T15:00:00.000Z", "available"],
    ["2026-07-27T19:59:59.999Z", "available"],
    ["2026-07-27T20:00:00.000Z", "unavailable"],
  ] as const)(
    "preserves adjacent-window behavior at %s",
    (instant, expectation) => {
      const policy = createScheduledPolicy([
        { weekday: "monday", start: "09:00", end: "12:00" },
        { weekday: "monday", start: "12:00", end: "17:00" },
      ]);

      expect(evaluateServiceAvailabilityPolicy(policy, new Date(instant))).toBe(
        expectation,
      );
    },
  );

  it("uses the converted local weekday when UTC is already the next day", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "22:00", end: "23:00" },
    ]);
    const instant = new Date("2026-07-28T01:30:00.000Z");

    expect(instant.getUTCDay()).toBe(2);
    expect(evaluateServiceAvailabilityPolicy(policy, instant)).toBe(
      "available",
    );
  });

  it("uses historical timezone data instead of a fixed modern offset", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "10:00" },
    ]);

    expect(
      evaluateServiceAvailabilityPolicy(
        policy,
        new Date("2018-01-15T11:30:00.000Z"),
      ),
    ).toBe("available");
  });

  it("handles local midnight and the preceding local day precisely", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "00:00", end: "01:00" },
    ]);

    expect(
      evaluateServiceAvailabilityPolicy(
        policy,
        new Date("2026-07-27T03:00:00.000Z"),
      ),
    ).toBe("available");
    expect(
      evaluateServiceAvailabilityPolicy(
        policy,
        new Date("2026-07-27T02:59:59.999Z"),
      ),
    ).toBe("unavailable");
  });

  it("excludes the complete local minute used as a window end", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "23:00", end: "23:59" },
    ]);

    expect(
      evaluateServiceAvailabilityPolicy(
        policy,
        new Date("2026-07-28T02:58:59.999Z"),
      ),
    ).toBe("available");
    expect(
      evaluateServiceAvailabilityPolicy(
        policy,
        new Date("2026-07-28T02:59:00.000Z"),
      ),
    ).toBe("unavailable");
  });

  it.each([
    undefined,
    null,
    "2026-07-27T12:00:00.000Z",
    0,
    {},
    [],
    new Date(Number.NaN),
    new Date("invalid"),
  ])("rejects invalid runtime instant %#", (instant) => {
    const policy = createNonScheduledPolicy("always");

    expect(() => evaluateRuntimeInstant(policy, instant)).toThrowError(
      expect.objectContaining({
        name: "ServiceAvailabilityEvaluationError",
        code: "invalid_service_availability_instant",
        message: "Invalid service availability instant",
      }),
    );
  });

  it("keeps invalid-instant errors free of source and policy data", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:17", end: "10:23" },
    ]);
    const rejectedValue = "sentinel-invalid-instant";

    try {
      evaluateRuntimeInstant(policy, rejectedValue);
      throw new Error("Expected evaluation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceAvailabilityEvaluationError);
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("instant");
      expect(error).not.toHaveProperty("timestamp");
      expect(error).not.toHaveProperty("timezone");
      expect(error).not.toHaveProperty("policy");
      expect(String(error)).not.toContain(rejectedValue);
      expect(String(error)).not.toContain(timezone);
      expect(String(error)).not.toContain("09:17");
      expect(Object.values(error as object)).not.toContain(rejectedValue);
    }
  });

  it("reads the supplied timestamp once without mutating or retaining inputs", () => {
    let getTimeCalls = 0;

    class ObservableDate extends Date {
      public override getTime(): number {
        getTimeCalls += 1;
        return super.getTime();
      }
    }

    const instant = new ObservableDate("2026-07-27T12:00:00.000Z");
    const originalTimestamp = Date.prototype.getTime.call(instant);
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "17:00" },
    ]);
    const originalPolicy = structuredClone(policy);

    expect(evaluateServiceAvailabilityPolicy(policy, instant)).toBe(
      "available",
    );
    expect(getTimeCalls).toBe(1);
    expect(Date.prototype.getTime.call(instant)).toBe(originalTimestamp);
    expect(policy).toEqual(originalPolicy);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(policy.schedule).not.toBeNull();

    if (policy.schedule === null) {
      throw new Error("Expected a scheduled policy");
    }

    expect(Object.isFrozen(policy.schedule)).toBe(true);
    expect(Object.isFrozen(policy.schedule.windows)).toBe(true);
    expect(policy.schedule.windows.every(Object.isFrozen)).toBe(true);
  });

  it("uses explicit formatter settings and no implicit current time", () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const formatToPartsSpy = vi.spyOn(
      Intl.DateTimeFormat.prototype,
      "formatToParts",
    );
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "17:00" },
    ]);

    try {
      expect(
        evaluateServiceAvailabilityPolicy(
          policy,
          new Date("2026-07-27T12:00:00.000Z"),
        ),
      ).toBe("available");
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(formatToPartsSpy).toHaveBeenCalledOnce();

      const formatter = formatToPartsSpy.mock.instances[0] as
        Intl.DateTimeFormat | undefined;

      expect(formatter?.resolvedOptions()).toMatchObject({
        locale: "en-US-u-ca-gregory-nu-latn",
        calendar: "gregory",
        numberingSystem: "latn",
        timeZone: timezone,
        hourCycle: "h23",
      });
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
      formatToPartsSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
