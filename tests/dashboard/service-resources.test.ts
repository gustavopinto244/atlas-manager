import { describe, expect, it } from "vitest";

import {
  formatCpuUsage,
  formatMemoryUsage,
  formatUptime,
  resourceObservationSummary,
} from "../../src/dashboard/service-resources.js";

describe("formatCpuUsage", () => {
  it("formats an available percentage to one decimal", () => {
    expect(formatCpuUsage({ outcome: "available", usagePercent: 12.345 })).toBe(
      "12.3%",
    );
  });

  it("reports unavailable for a non-available observation", () => {
    expect(formatCpuUsage({ outcome: "unavailable", reason: "timeout" })).toBe(
      "unavailable",
    );
    expect(formatCpuUsage(undefined)).toBe("unavailable");
    expect(formatCpuUsage(null)).toBe("unavailable");
  });
});

describe("formatMemoryUsage", () => {
  it("formats usage with a limit", () => {
    expect(
      formatMemoryUsage({
        outcome: "available",
        usageBytes: 104_857_600,
        limitBytes: 536_870_912,
      }),
    ).toBe("100.0 MiB / 512.0 MiB");
  });

  it("formats usage without a limit rather than showing a zero limit", () => {
    expect(
      formatMemoryUsage({
        outcome: "available",
        usageBytes: 1_024,
        limitBytes: null,
      }),
    ).toBe("1.0 KiB");
  });

  it("reports unavailable when the observation is not available", () => {
    expect(
      formatMemoryUsage({ outcome: "unavailable", reason: "unsupported" }),
    ).toBe("unavailable");
  });
});

describe("formatUptime", () => {
  it.each([
    [30, "30s"],
    [90, "1m"],
    [3_661, "1h 1m"],
    [90_000, "1d 1h"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatUptime(seconds)).toBe(expected);
  });

  it("reports unavailable for null, negative or non-finite values", () => {
    expect(formatUptime(null)).toBe("unavailable");
    expect(formatUptime(-1)).toBe("unavailable");
    expect(formatUptime(Number.NaN)).toBe("unavailable");
  });
});

describe("resourceObservationSummary", () => {
  it("summarizes an available observation", () => {
    expect(
      resourceObservationSummary({
        outcome: "available",
        cpu: { outcome: "available", usagePercent: 5 },
        memory: {
          outcome: "available",
          usageBytes: 1_024,
          limitBytes: null,
        },
        uptimeSeconds: 60,
      }),
    ).toBe("CPU: 5.0% · Memory: 1.0 KiB · Uptime: 1m");
  });

  it("summarizes an unavailable observation with its reason", () => {
    expect(
      resourceObservationSummary({
        outcome: "unavailable",
        reason: "permission_denied",
      }),
    ).toBe("Resources: permission denied");
  });

  it("summarizes a missing observation without throwing", () => {
    expect(resourceObservationSummary(undefined)).toBe(
      "Resources: unavailable",
    );
  });
});
