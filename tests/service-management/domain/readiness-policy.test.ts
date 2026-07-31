import { describe, expect, it } from "vitest";

import {
  createReadinessPolicy,
  defaultReadinessPolicy,
  ReadinessPolicyValidationError,
} from "../../../src/service-management/domain/readiness-policy.js";

function expectPolicyError(
  input: Record<string, unknown>,
  code: ReadinessPolicyValidationError["code"],
): void {
  expect(() => createReadinessPolicy(input)).toThrowError(
    expect.objectContaining({
      name: "ReadinessPolicyValidationError",
      code,
    }),
  );
}

describe("readiness policy", () => {
  it("defaults omitted values", () => {
    const policy = defaultReadinessPolicy();

    expect(policy).toEqual({
      mode: "runtime",
      timeoutMilliseconds: 30000,
      pollIntervalMilliseconds: 500,
    });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it.each(["runtime", "health"] as const)(
    "applies defaults for mode-only %s policies",
    (mode) => {
      expect(createReadinessPolicy({ mode })).toEqual({
        mode,
        timeoutMilliseconds: 30000,
        pollIntervalMilliseconds: 500,
      });
    },
  );

  it("accepts exact timeout and poll-interval boundaries", () => {
    expect(
      createReadinessPolicy({
        mode: "health",
        timeoutMilliseconds: 1000,
        pollIntervalMilliseconds: 100,
      }),
    ).toEqual({
      mode: "health",
      timeoutMilliseconds: 1000,
      pollIntervalMilliseconds: 100,
    });
    expect(
      createReadinessPolicy({
        mode: "runtime",
        timeoutMilliseconds: 120000,
        pollIntervalMilliseconds: 5000,
      }),
    ).toEqual({
      mode: "runtime",
      timeoutMilliseconds: 120000,
      pollIntervalMilliseconds: 5000,
    });
    expect(
      createReadinessPolicy({
        mode: "runtime",
        timeoutMilliseconds: 1000,
        pollIntervalMilliseconds: 1000,
      }).pollIntervalMilliseconds,
    ).toBe(1000);
  });

  it.each([
    ["timeout below minimum", { mode: "runtime", timeoutMilliseconds: 999 }],
    ["timeout above maximum", { mode: "runtime", timeoutMilliseconds: 120001 }],
    ["zero timeout", { mode: "runtime", timeoutMilliseconds: 0 }],
    ["negative timeout", { mode: "runtime", timeoutMilliseconds: -1 }],
    ["fractional timeout", { mode: "runtime", timeoutMilliseconds: 1.5 }],
    ["NaN timeout", { mode: "runtime", timeoutMilliseconds: Number.NaN }],
    [
      "positive infinity timeout",
      { mode: "runtime", timeoutMilliseconds: Number.POSITIVE_INFINITY },
    ],
    [
      "negative infinity timeout",
      { mode: "runtime", timeoutMilliseconds: Number.NEGATIVE_INFINITY },
    ],
    [
      "unsafe timeout",
      { mode: "runtime", timeoutMilliseconds: Number.MAX_SAFE_INTEGER + 1 },
    ],
  ] as const)("rejects %s with invalid_timeout", (_label, input) => {
    expectPolicyError(input, "invalid_timeout");
  });

  it.each([
    ["poll below minimum", { mode: "runtime", pollIntervalMilliseconds: 99 }],
    ["poll above maximum", { mode: "runtime", pollIntervalMilliseconds: 5001 }],
    ["zero poll", { mode: "runtime", pollIntervalMilliseconds: 0 }],
    ["negative poll", { mode: "runtime", pollIntervalMilliseconds: -1 }],
    ["fractional poll", { mode: "runtime", pollIntervalMilliseconds: 1.5 }],
    ["NaN poll", { mode: "runtime", pollIntervalMilliseconds: Number.NaN }],
    [
      "positive infinity poll",
      { mode: "runtime", pollIntervalMilliseconds: Number.POSITIVE_INFINITY },
    ],
    [
      "negative infinity poll",
      { mode: "runtime", pollIntervalMilliseconds: Number.NEGATIVE_INFINITY },
    ],
    [
      "unsafe poll",
      {
        mode: "runtime",
        pollIntervalMilliseconds: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
  ] as const)("rejects %s with invalid_poll_interval", (_label, input) => {
    expectPolicyError(input, "invalid_poll_interval");
  });

  it.each([
    ["a string", "1000"],
    ["null", null],
    ["a boolean", true],
    ["an object", {}],
    ["an array", []],
  ])("rejects invalid timeout type: %s", (_label, timeoutMilliseconds) => {
    expectPolicyError(
      { mode: "runtime", timeoutMilliseconds },
      "invalid_timeout",
    );
  });

  it.each([
    ["a string", "100"],
    ["null", null],
    ["a boolean", true],
    ["an object", {}],
    ["an array", []],
  ])("rejects invalid poll type: %s", (_label, pollIntervalMilliseconds) => {
    expectPolicyError(
      { mode: "runtime", pollIntervalMilliseconds },
      "invalid_poll_interval",
    );
  });

  it("rejects a poll interval above the timeout with its exact category", () => {
    expectPolicyError(
      {
        mode: "runtime",
        timeoutMilliseconds: 1000,
        pollIntervalMilliseconds: 1001,
      },
      "poll_interval_exceeds_timeout",
    );
  });

  it.each([
    ["an omitted mode", {}],
    ["an unknown string", { mode: "other" }],
    ["an uppercase variant", { mode: "RUNTIME" }],
    ["null", { mode: null }],
    ["a number", { mode: 42 }],
  ])("rejects %s with invalid_mode", (_label, input) => {
    expectPolicyError(input, "invalid_mode");
  });

  it.each([
    ["one unknown field", { mode: "runtime", unknown: true }],
    ["multiple unknown fields", { mode: "runtime", foo: 1, bar: 2 }],
  ])("rejects %s with invalid_field", (_label, input) => {
    expectPolicyError(input, "invalid_field");
  });

  it("freezes the policy and does not retain mutable input", () => {
    const input: Record<string, unknown> = {
      mode: "runtime",
      timeoutMilliseconds: 2000,
      pollIntervalMilliseconds: 200,
    };
    const policy = createReadinessPolicy(input);

    input.timeoutMilliseconds = 5000;
    input.pollIntervalMilliseconds = 500;

    expect(policy).toEqual({
      mode: "runtime",
      timeoutMilliseconds: 2000,
      pollIntervalMilliseconds: 200,
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(
      Object.isFrozen(new ReadinessPolicyValidationError("invalid_mode")),
    ).toBe(true);
  });
});
