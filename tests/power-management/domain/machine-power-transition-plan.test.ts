import { describe, expect, it } from "vitest";

import {
  createMachinePowerTransitionPlan,
  MachinePowerTransitionPlanValidationError,
} from "../../../src/power-management/domain/machine-power-transition-plan.js";

const SCHEDULED_FOR = "2026-08-03T11:00:00.000Z";

function expectPlanError(input: unknown, code: string): void {
  expect(() => createMachinePowerTransitionPlan(input)).toThrowError(
    expect.objectContaining({
      name: "MachinePowerTransitionPlanValidationError",
      code,
    }),
  );
}

describe("machine power transition plan", () => {
  it("creates immutable planned and not-planned transitions", () => {
    const notPlanned = createMachinePowerTransitionPlan({
      state: "not_planned",
    });
    const planned = createMachinePowerTransitionPlan({
      state: "planned",
      scheduledFor: SCHEDULED_FOR,
    });

    expect(notPlanned).toEqual({ state: "not_planned" });
    expect(planned).toEqual({ state: "planned", scheduledFor: SCHEDULED_FOR });
    expect(Object.isFrozen(notPlanned)).toBe(true);
    expect(Object.isFrozen(planned)).toBe(true);
  });

  it.each([
    ["non-record", null, "invalid_record"],
    ["unknown state", { state: "unknown" }, "invalid_state"],
    ["missing timestamp", { state: "planned" }, "missing_scheduled_for"],
    [
      "unexpected timestamp",
      { state: "not_planned", scheduledFor: SCHEDULED_FOR },
      "unexpected_scheduled_for",
    ],
    [
      "malformed timestamp",
      { state: "planned", scheduledFor: "bad" },
      "invalid_scheduled_for",
    ],
    [
      "unknown field",
      { state: "not_planned", reason: "later" },
      "invalid_field",
    ],
  ] as const)("rejects %s", (_label, input, code) => {
    expectPlanError(input, code);
  });

  it("freezes its validation error", () => {
    expect(
      Object.isFrozen(
        new MachinePowerTransitionPlanValidationError("invalid_record"),
      ),
    ).toBe(true);
  });
});
