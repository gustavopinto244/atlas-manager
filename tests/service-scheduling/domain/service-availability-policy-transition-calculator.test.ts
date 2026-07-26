import { describe, expect, it, vi } from "vitest";

import { calculateServiceAvailabilityPolicyTransitions } from "../../../src/service-scheduling/domain/service-availability-policy-transition-calculator.js";
import type { ServiceAvailabilityPolicyTransition } from "../../../src/service-scheduling/domain/service-availability-policy-transition.js";
import {
  createServiceAvailabilityPolicy,
  type ServiceAvailabilityPolicy,
} from "../../../src/service-scheduling/domain/service-availability-policy.js";
import {
  ServiceAvailabilityTransitionCalculationError,
  type ServiceAvailabilityTransitionCalculationErrorCode,
} from "../../../src/service-scheduling/domain/service-availability-transition-calculation-error.js";

const timezone = "America/Sao_Paulo";

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

function calculate(
  policy: ServiceAvailabilityPolicy,
  fromExclusive: string,
  toInclusive: string,
): readonly ServiceAvailabilityPolicyTransition[] {
  return calculateServiceAvailabilityPolicyTransitions(
    policy,
    new Date(fromExclusive),
    new Date(toInclusive),
  );
}

function expectCalculationError(
  fromExclusive: unknown,
  toInclusive: unknown,
  code: ServiceAvailabilityTransitionCalculationErrorCode,
): ServiceAvailabilityTransitionCalculationError {
  try {
    calculateServiceAvailabilityPolicyTransitions(
      createServiceAvailabilityPolicy({ mode: "always" }),
      fromExclusive as Date,
      toInclusive as Date,
    );
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceAvailabilityTransitionCalculationError);
    expect(error).toEqual(
      expect.objectContaining({
        name: "ServiceAvailabilityTransitionCalculationError",
        code,
        message: `Service availability transition calculation failed: ${code}`,
      }),
    );
    expect(error).not.toHaveProperty("cause");
    return error as ServiceAvailabilityTransitionCalculationError;
  }

  throw new Error("Expected transition calculation to fail");
}

describe("calculateServiceAvailabilityPolicyTransitions", () => {
  it.each(["always", "manual", "disabled"] as const)(
    "returns an empty frozen result for %s",
    (mode) => {
      const policy = createServiceAvailabilityPolicy({ mode });

      const transitions = calculate(
        policy,
        "2026-07-27T11:00:00.000Z",
        "2026-07-28T11:00:00.000Z",
      );

      expect(transitions).toEqual([]);
      expect(Object.isFrozen(transitions)).toBe(true);
    },
  );

  it("calculates both boundaries of one complete window", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "17:00" },
    ]);

    const transitions = calculate(
      policy,
      "2026-07-27T11:00:00.000Z",
      "2026-07-27T21:00:00.000Z",
    );

    expect(transitions).toEqual([
      {
        kind: "became_available",
        scheduledFor: "2026-07-27T12:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2026-07-27T20:00:00.000Z",
      },
    ]);
    expect(Object.isFrozen(transitions)).toBe(true);
    expect(transitions.every(Object.isFrozen)).toBe(true);
    expect(transitions.map(Object.keys)).toEqual([
      ["kind", "scheduledFor"],
      ["kind", "scheduledFor"],
    ]);
  });

  it.each([
    [
      "window start",
      "2026-07-27T11:00:00.000Z",
      "2026-07-27T12:00:00.000Z",
      [
        {
          kind: "became_available",
          scheduledFor: "2026-07-27T12:00:00.000Z",
        },
      ],
    ],
    [
      "window end",
      "2026-07-27T19:00:00.000Z",
      "2026-07-27T20:00:00.000Z",
      [
        {
          kind: "became_unavailable",
          scheduledFor: "2026-07-27T20:00:00.000Z",
        },
      ],
    ],
    [
      "inside window",
      "2026-07-27T13:00:00.000Z",
      "2026-07-27T14:00:00.000Z",
      [],
    ],
    [
      "outside window",
      "2026-07-27T21:00:00.000Z",
      "2026-07-27T22:00:00.000Z",
      [],
    ],
  ] as const)(
    "calculates only actual transitions for %s",
    (_description, fromExclusive, toInclusive, expected) => {
      const policy = createScheduledPolicy([
        { weekday: "monday", start: "09:00", end: "17:00" },
      ]);

      expect(calculate(policy, fromExclusive, toInclusive)).toEqual(expected);
    },
  );

  it("excludes a transition at fromExclusive and includes one at toInclusive", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "17:00" },
    ]);

    expect(
      calculate(policy, "2026-07-27T12:00:00.000Z", "2026-07-27T20:00:00.000Z"),
    ).toEqual([
      {
        kind: "became_unavailable",
        scheduledFor: "2026-07-27T20:00:00.000Z",
      },
    ]);
  });

  it("orders transitions across multiple windows and weekdays", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "13:00", end: "17:00" },
      { weekday: "tuesday", start: "10:00", end: "11:00" },
    ]);

    expect(
      calculate(policy, "2026-07-27T11:00:00.000Z", "2026-07-28T15:00:00.000Z"),
    ).toEqual([
      {
        kind: "became_available",
        scheduledFor: "2026-07-27T12:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2026-07-27T15:00:00.000Z",
      },
      {
        kind: "became_available",
        scheduledFor: "2026-07-27T16:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2026-07-27T20:00:00.000Z",
      },
      {
        kind: "became_available",
        scheduledFor: "2026-07-28T13:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2026-07-28T14:00:00.000Z",
      },
    ]);
  });

  it("does not synthesize transitions between adjacent windows", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "12:00", end: "17:00" },
    ]);

    expect(
      calculate(policy, "2026-07-27T11:00:00.000Z", "2026-07-27T21:00:00.000Z"),
    ).toEqual([
      {
        kind: "became_available",
        scheduledFor: "2026-07-27T12:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2026-07-27T20:00:00.000Z",
      },
    ]);
  });

  it("preserves real transitions across a gap between windows", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "13:00", end: "17:00" },
    ]);

    expect(
      calculate(policy, "2026-07-27T14:00:00.000Z", "2026-07-27T17:00:00.000Z"),
    ).toEqual([
      {
        kind: "became_unavailable",
        scheduledFor: "2026-07-27T15:00:00.000Z",
      },
      {
        kind: "became_available",
        scheduledFor: "2026-07-27T16:00:00.000Z",
      },
    ]);
  });

  it("continues weekly behavior across Sunday into Monday", () => {
    const policy = createScheduledPolicy([
      { weekday: "sunday", start: "23:00", end: "23:59" },
      { weekday: "monday", start: "00:00", end: "01:00" },
    ]);

    expect(
      calculate(policy, "2026-08-03T01:00:00.000Z", "2026-08-03T05:00:00.000Z"),
    ).toEqual([
      {
        kind: "became_available",
        scheduledFor: "2026-08-03T02:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2026-08-03T02:59:00.000Z",
      },
      {
        kind: "became_available",
        scheduledFor: "2026-08-03T03:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2026-08-03T04:00:00.000Z",
      },
    ]);
  });

  it("uses historical policy-timezone offsets instead of a fixed offset", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "10:00" },
    ]);

    expect(
      calculate(policy, "2018-01-15T10:00:00.000Z", "2018-01-15T13:00:00.000Z"),
    ).toEqual([
      {
        kind: "became_available",
        scheduledFor: "2018-01-15T11:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2018-01-15T12:00:00.000Z",
      },
    ]);
  });

  it("follows evaluator changes through a daylight-saving forward gap", () => {
    const policy = createScheduledPolicy([
      { weekday: "sunday", start: "00:30", end: "01:30" },
    ]);

    expect(
      calculate(policy, "2018-11-04T02:00:00.000Z", "2018-11-04T04:00:00.000Z"),
    ).toEqual([
      {
        kind: "became_available",
        scheduledFor: "2018-11-04T03:00:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2018-11-04T03:30:00.000Z",
      },
    ]);
  });

  it("preserves distinct UTC transitions through repeated local times", () => {
    const policy = createScheduledPolicy([
      { weekday: "saturday", start: "23:15", end: "23:45" },
    ]);

    expect(
      calculate(policy, "2018-02-18T01:00:00.000Z", "2018-02-18T03:00:00.000Z"),
    ).toEqual([
      {
        kind: "became_available",
        scheduledFor: "2018-02-18T01:15:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2018-02-18T01:45:00.000Z",
      },
      {
        kind: "became_available",
        scheduledFor: "2018-02-18T02:15:00.000Z",
      },
      {
        kind: "became_unavailable",
        scheduledFor: "2018-02-18T02:45:00.000Z",
      },
    ]);
  });

  it.each([
    [undefined, new Date("2026-07-27T12:00:00.000Z")],
    [null, new Date("2026-07-27T12:00:00.000Z")],
    ["2026-07-27T11:00:00.000Z", new Date("2026-07-27T12:00:00.000Z")],
    [0, new Date("2026-07-27T12:00:00.000Z")],
    [{}, new Date("2026-07-27T12:00:00.000Z")],
    [new Date("2026-07-27T11:00:00.000Z"), undefined],
    [new Date("invalid"), new Date("2026-07-27T12:00:00.000Z")],
    [new Date("2026-07-27T11:00:00.000Z"), new Date("invalid")],
  ])("rejects invalid runtime interval boundaries", (from, to) => {
    expectCalculationError(from, to, "invalid_transition_interval");
  });

  it.each([
    ["2026-07-27T12:00:00.000Z", "2026-07-27T12:00:00.000Z"],
    ["2026-07-27T13:00:00.000Z", "2026-07-27T12:00:00.000Z"],
  ])("rejects equal or reversed intervals", (from, to) => {
    expectCalculationError(
      new Date(from),
      new Date(to),
      "invalid_transition_interval",
    );
  });

  it.each([
    ["2026-07-27T11:00:01.000Z", "2026-07-27T12:00:00.000Z"],
    ["2026-07-27T11:00:00.001Z", "2026-07-27T12:00:00.000Z"],
    ["2026-07-27T11:00:00.000Z", "2026-07-27T12:00:01.000Z"],
    ["2026-07-27T11:00:00.000Z", "2026-07-27T12:00:00.001Z"],
  ])("rejects non-minute-aligned boundaries", (from, to) => {
    expectCalculationError(
      new Date(from),
      new Date(to),
      "transition_interval_not_minute_aligned",
    );
  });

  it("accepts exactly eight days and rejects eight days plus one minute", () => {
    const policy = createServiceAvailabilityPolicy({ mode: "always" });
    const from = new Date("2026-07-20T00:00:00.000Z");

    expect(
      calculateServiceAvailabilityPolicyTransitions(
        policy,
        from,
        new Date("2026-07-28T00:00:00.000Z"),
      ),
    ).toEqual([]);
    expectCalculationError(
      from,
      new Date("2026-07-28T00:01:00.000Z"),
      "transition_interval_limit_exceeded",
    );
  });

  it("returns deeply immutable transitions without mutating inputs", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "10:00" },
    ]);
    const policySnapshot = structuredClone(policy);
    const from = new Date("2026-07-27T11:00:00.000Z");
    const to = new Date("2026-07-27T14:00:00.000Z");
    const fromTimestamp = from.getTime();
    const toTimestamp = to.getTime();

    const transitions = calculateServiceAvailabilityPolicyTransitions(
      policy,
      from,
      to,
    );

    expect(() => {
      (transitions as ServiceAvailabilityPolicyTransition[]).push({
        kind: "became_available",
        scheduledFor: "2026-07-27T15:00:00.000Z",
      });
    }).toThrow(TypeError);
    expect(() => {
      (
        transitions[0] as {
          kind: "became_available" | "became_unavailable";
        }
      ).kind = "became_unavailable";
    }).toThrow(TypeError);
    expect(() => {
      Object.assign(transitions[0] ?? {}, { metadata: "private" });
    }).toThrow(TypeError);
    expect(() => {
      delete (transitions[0] as { scheduledFor?: string }).scheduledFor;
    }).toThrow(TypeError);
    expect(policy).toEqual(policySnapshot);
    expect(from.getTime()).toBe(fromTimestamp);
    expect(to.getTime()).toBe(toTimestamp);
    expect(Object.isFrozen(from)).toBe(false);
    expect(Object.isFrozen(to)).toBe(false);
  });

  it("is deterministic and does not use current time or process side effects", () => {
    const policy = createScheduledPolicy([
      { weekday: "monday", start: "09:00", end: "10:00" },
    ]);
    const from = new Date("2026-07-27T11:00:00.000Z");
    const to = new Date("2026-07-27T14:00:00.000Z");
    const dateNow = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const first = calculateServiceAvailabilityPolicyTransitions(
        policy,
        from,
        to,
      );
      const second = calculateServiceAvailabilityPolicyTransitions(
        policy,
        from,
        to,
      );

      expect(first).toEqual(second);
      expect(dateNow).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    }
  });

  it("propagates evaluator failures without transition-error wrapping", () => {
    const invalidPolicy = {
      mode: "scheduled",
      timezone: "Private/Invalid",
      schedule: {
        windows: [{ weekday: "monday", start: "09:00", end: "10:00" }],
      },
    } as unknown as ServiceAvailabilityPolicy;

    expect(() =>
      calculate(
        invalidPolicy,
        "2026-07-27T11:00:00.000Z",
        "2026-07-27T12:00:00.000Z",
      ),
    ).toThrow(RangeError);
  });

  it("keeps interval errors free of supplied values and policy data", () => {
    const secretTimestamp = "2026-07-27T11:00:01.000Z";
    const error = expectCalculationError(
      new Date(secretTimestamp),
      new Date("2026-07-27T12:00:00.000Z"),
      "transition_interval_not_minute_aligned",
    );
    const serialized = JSON.stringify(error);

    expect(error.message).not.toContain(secretTimestamp);
    expect(error.code).not.toContain(secretTimestamp);
    expect(serialized).not.toContain(secretTimestamp);
    expect(Object.keys(error).sort()).toEqual(["code", "name"]);
  });
});
