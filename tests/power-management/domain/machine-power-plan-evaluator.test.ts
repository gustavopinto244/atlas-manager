import { describe, expect, it } from "vitest";

import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";
import {
  evaluateMachinePowerPlan,
  MachinePowerPlanEvaluationError,
} from "../../../src/power-management/domain/machine-power-plan-evaluator.js";

const POLICY = createMachineOperatingPolicy({
  mode: "scheduled",
  timezone: "America/Sao_Paulo",
  weeklySchedule: {
    windows: [
      { dayOfWeek: "monday", start: "08:00", end: "12:00" },
      { dayOfWeek: "monday", start: "12:00", end: "18:00" },
      { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
    ],
  },
});

describe("machine power plan evaluator", () => {
  it("evaluates exact starts, ends, and adjacent windows", () => {
    const beforeStart = evaluateMachinePowerPlan(
      POLICY,
      "2026-08-03T10:59:59.999Z",
    );
    const atStart = evaluateMachinePowerPlan(
      POLICY,
      "2026-08-03T11:00:00.000Z",
    );
    const beforeEnd = evaluateMachinePowerPlan(
      POLICY,
      "2026-08-03T20:59:59.999Z",
    );
    const atEnd = evaluateMachinePowerPlan(POLICY, "2026-08-03T21:00:00.000Z");
    const atAdjacentBoundary = evaluateMachinePowerPlan(
      POLICY,
      "2026-08-03T15:00:00.000Z",
    );

    expect(beforeStart.expectation).toBe("offline");
    expect(beforeStart.nextWake).toEqual({
      state: "planned",
      scheduledFor: "2026-08-03T11:00:00.000Z",
    });
    expect(atStart.expectation).toBe("operating");
    expect(atStart.nextShutdown).toEqual({
      state: "planned",
      scheduledFor: "2026-08-03T21:00:00.000Z",
    });
    expect(beforeEnd.expectation).toBe("operating");
    expect(atEnd.expectation).toBe("offline");
    expect(atEnd.nextWake).toEqual({
      state: "planned",
      scheduledFor: "2026-08-04T12:00:00.000Z",
    });
    expect(atAdjacentBoundary.nextShutdown).toEqual({
      state: "planned",
      scheduledFor: "2026-08-03T21:00:00.000Z",
    });
  });

  it("plans offline periods, weekdays, and weekly wraparound", () => {
    const betweenWindows = evaluateMachinePowerPlan(
      POLICY,
      "2026-08-03T21:30:00.000Z",
    );
    const afterFinalWindow = evaluateMachinePowerPlan(
      POLICY,
      "2026-08-04T21:00:00.000Z",
    );

    expect(betweenWindows).toMatchObject({
      expectation: "offline",
      nextWake: {
        state: "planned",
        scheduledFor: "2026-08-04T12:00:00.000Z",
      },
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-04T20:00:00.000Z",
      },
    });
    expect(afterFinalWindow).toMatchObject({
      expectation: "offline",
      nextWake: {
        state: "planned",
        scheduledFor: "2026-08-10T11:00:00.000Z",
      },
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-10T21:00:00.000Z",
      },
    });
  });

  it("uses the local weekday when it differs from the UTC weekday", () => {
    const policy = createMachineOperatingPolicy({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [
          { dayOfWeek: "sunday", start: "22:00", end: "23:59" },
          { dayOfWeek: "monday", start: "08:00", end: "09:00" },
        ],
      },
    });
    const plan = evaluateMachinePowerPlan(policy, "2026-08-03T02:30:00.000Z");

    expect(plan.expectation).toBe("operating");
    expect(plan.nextShutdown).toEqual({
      state: "planned",
      scheduledFor: "2026-08-03T02:59:00.000Z",
    });
    expect(plan.nextWake).toEqual({
      state: "planned",
      scheduledFor: "2026-08-03T11:00:00.000Z",
    });
  });

  it.each([
    ["always_on", { mode: "always_on" }, "operating"],
    ["manual", { mode: "manual" }, "manual"],
  ] as const)(
    "does not plan transitions for %s",
    (_label, policyInput, expectation) => {
      const policy = createMachineOperatingPolicy(policyInput);
      const plan = evaluateMachinePowerPlan(policy, "2026-08-03T12:00:00.000Z");
      expect(plan).toMatchObject({
        expectation,
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "not_planned" },
      });
    },
  );

  it("returns the same result regardless of input window order", () => {
    const reversed = createMachineOperatingPolicy({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [
          { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
          { dayOfWeek: "monday", start: "12:00", end: "18:00" },
          { dayOfWeek: "monday", start: "08:00", end: "12:00" },
        ],
      },
    });
    expect(
      evaluateMachinePowerPlan(reversed, "2026-08-03T10:00:00.000Z"),
    ).toEqual(evaluateMachinePowerPlan(POLICY, "2026-08-03T10:00:00.000Z"));
  });

  it("rejects malformed evaluation instants and exposes no raw value", () => {
    expect(() => evaluateMachinePowerPlan(POLICY, "bad")).toThrowError(
      expect.objectContaining({
        name: "MachinePowerPlanEvaluationError",
        code: "invalid_evaluated_at",
      }),
    );
    expect(
      Object.isFrozen(
        new MachinePowerPlanEvaluationError("invalid_evaluated_at"),
      ),
    ).toBe(true);
  });
});
