import { describe, expect, it } from "vitest";

import {
  createMachineOperatingPolicy,
  MachineOperatingPolicyValidationError,
} from "../../../src/power-management/domain/machine-operating-policy.js";

const WINDOWS = [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }];

function scheduledPolicy() {
  return {
    mode: "scheduled" as const,
    timezone: "America/Sao_Paulo",
    weeklySchedule: { windows: WINDOWS },
  };
}

function expectPolicyError(input: unknown, code: string): void {
  expect(() => createMachineOperatingPolicy(input)).toThrowError(
    expect.objectContaining({
      name: "MachineOperatingPolicyValidationError",
      code,
    }),
  );
}

describe("machine operating policy", () => {
  it.each(["always_on", "manual"] as const)("creates %s", (mode) => {
    const result = createMachineOperatingPolicy({ mode });
    expect(result).toEqual({ mode });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("creates a scheduled policy with an immutable nested schedule", () => {
    const result = createMachineOperatingPolicy(scheduledPolicy());

    expect(result).toEqual({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: { windows: WINDOWS },
    });
    if (result.mode !== "scheduled") {
      throw new Error("Expected a scheduled machine operating policy");
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.weeklySchedule)).toBe(true);
    expect(Object.isFrozen(result.weeklySchedule.windows)).toBe(true);
  });

  it.each([
    ["null", null, "invalid_record"],
    ["array", [], "invalid_record"],
    ["missing mode", {}, "missing_mode"],
    ["unknown mode", { mode: "unknown" }, "invalid_mode"],
    ["uppercase mode", { mode: "SCHEDULED" }, "invalid_mode"],
    ["whitespace mode", { mode: " scheduled" }, "invalid_mode"],
    [
      "unknown field",
      { mode: "always_on", timezone: "America/Sao_Paulo" },
      "invalid_field",
    ],
    [
      "timezone on manual",
      { mode: "manual", timezone: "America/Sao_Paulo" },
      "invalid_field",
    ],
    [
      "schedule on always_on",
      { mode: "always_on", weeklySchedule: { windows: WINDOWS } },
      "invalid_field",
    ],
    [
      "missing scheduled timezone",
      { mode: "scheduled", weeklySchedule: { windows: WINDOWS } },
      "missing_timezone",
    ],
    [
      "invalid timezone",
      { ...scheduledPolicy(), timezone: "UTC" },
      "invalid_timezone",
    ],
    [
      "timezone case",
      { ...scheduledPolicy(), timezone: "america/sao_paulo" },
      "invalid_timezone",
    ],
    [
      "timezone whitespace",
      { ...scheduledPolicy(), timezone: "America/Sao_Paulo " },
      "invalid_timezone",
    ],
    [
      "missing schedule",
      { mode: "scheduled", timezone: "America/Sao_Paulo" },
      "missing_weekly_schedule",
    ],
  ] as const)("rejects %s", (_label, input, code) => {
    expectPolicyError(input, code);
  });

  it("preserves the weekly schedule validation category", () => {
    expect(() =>
      createMachineOperatingPolicy({
        ...scheduledPolicy(),
        weeklySchedule: { windows: [] },
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "MachineWeeklyOperatingScheduleValidationError",
        code: "empty_windows",
      }),
    );
  });

  it("isolates caller input and freezes errors", () => {
    const input = scheduledPolicy();
    const result = createMachineOperatingPolicy(input);
    input.weeklySchedule.windows[0]!.start = "10:00";

    if (result.mode !== "scheduled") {
      throw new Error("Expected a scheduled machine operating policy");
    }
    expect(result.weeklySchedule.windows[0]!.start).toBe("08:00");
    expect(
      Object.isFrozen(
        new MachineOperatingPolicyValidationError("invalid_mode"),
      ),
    ).toBe(true);
  });
});
