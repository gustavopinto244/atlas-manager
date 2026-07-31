import { describe, expect, it } from "vitest";

import {
  createReadinessPolicy,
  defaultReadinessPolicy,
} from "../../../src/service-management/domain/readiness-policy.js";

describe("readiness policy", () => {
  it("defaults omitted values", () => {
    expect(defaultReadinessPolicy()).toEqual({
      mode: "runtime",
      timeoutMilliseconds: 30000,
      pollIntervalMilliseconds: 500,
    });
  });

  it("accepts bounded safe integer values", () => {
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
  });

  it.each([
    { mode: "other" },
    { mode: "runtime", unknown: true },
    { mode: "runtime", timeoutMilliseconds: 0 },
    { mode: "runtime", pollIntervalMilliseconds: 6000 },
    {
      mode: "runtime",
      timeoutMilliseconds: 1000,
      pollIntervalMilliseconds: 1001,
    },
    { mode: "runtime", timeoutMilliseconds: Number.MAX_SAFE_INTEGER + 1 },
    { mode: "runtime", timeoutMilliseconds: 1.5 },
  ])("rejects invalid policy %#", (input) => {
    expect(() => createReadinessPolicy(input)).toThrow();
  });
});
