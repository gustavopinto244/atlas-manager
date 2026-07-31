import { describe, expect, it } from "vitest";

import {
  createMachinePowerPlan,
  MachinePowerPlanValidationError,
} from "../../../src/power-management/domain/machine-power-plan.js";

const EVALUATED_AT = "2026-08-03T10:00:00.000Z";
const SHUTDOWN = "2026-08-03T21:00:00.000Z";
const WAKE = "2026-08-04T12:00:00.000Z";

function plan(input: unknown) {
  return createMachinePowerPlan(input);
}

describe("machine power plan", () => {
  it("creates always-on and manual plans without transitions", () => {
    expect(
      plan({
        evaluatedAt: EVALUATED_AT,
        expectation: "operating",
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "not_planned" },
      }),
    ).toEqual({
      evaluatedAt: EVALUATED_AT,
      expectation: "operating",
      nextShutdown: { state: "not_planned" },
      nextWake: { state: "not_planned" },
    });
    expect(
      plan({
        evaluatedAt: EVALUATED_AT,
        expectation: "manual",
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "not_planned" },
      }).expectation,
    ).toBe("manual");
  });

  it("creates ordered operating and offline plans", () => {
    const operating = plan({
      evaluatedAt: EVALUATED_AT,
      expectation: "operating",
      nextShutdown: { state: "planned", scheduledFor: SHUTDOWN },
      nextWake: { state: "planned", scheduledFor: WAKE },
    });
    const offline = plan({
      evaluatedAt: EVALUATED_AT,
      expectation: "offline",
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-04T20:00:00.000Z",
      },
      nextWake: { state: "planned", scheduledFor: WAKE },
    });

    expect(operating.nextShutdown).toEqual({
      state: "planned",
      scheduledFor: SHUTDOWN,
    });
    expect(offline.nextWake).toEqual({ state: "planned", scheduledFor: WAKE });
    expect(Object.isFrozen(operating)).toBe(true);
    expect(Object.isFrozen(operating.nextShutdown)).toBe(true);
    expect(Object.isFrozen(operating.nextWake)).toBe(true);
  });

  it.each([
    ["invalid record", null, "invalid_record"],
    [
      "unknown field",
      {
        evaluatedAt: EVALUATED_AT,
        expectation: "operating",
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "not_planned" },
        extra: true,
      },
      "invalid_field",
    ],
    [
      "invalid evaluatedAt",
      {
        evaluatedAt: "bad",
        expectation: "operating",
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "not_planned" },
      },
      "invalid_evaluated_at",
    ],
    [
      "invalid expectation",
      {
        evaluatedAt: EVALUATED_AT,
        expectation: "running",
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "not_planned" },
      },
      "invalid_expectation",
    ],
    [
      "invalid transition",
      {
        evaluatedAt: EVALUATED_AT,
        expectation: "offline",
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "planned", scheduledFor: WAKE },
      },
      "invalid_transition_combination",
    ],
    [
      "wrong ordering",
      {
        evaluatedAt: EVALUATED_AT,
        expectation: "operating",
        nextShutdown: { state: "planned", scheduledFor: WAKE },
        nextWake: { state: "planned", scheduledFor: SHUTDOWN },
      },
      "invalid_transition_combination",
    ],
  ] as const)("rejects %s", (_label, input, code) => {
    expect(() => plan(input)).toThrowError(
      expect.objectContaining({
        name: "MachinePowerPlanValidationError",
        code,
      }),
    );
  });

  it("rejects mixed transitions for an operating plan", () => {
    expect(() =>
      plan({
        evaluatedAt: EVALUATED_AT,
        expectation: "operating",
        nextShutdown: { state: "planned", scheduledFor: SHUTDOWN },
        nextWake: { state: "not_planned" },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "invalid_transition_combination" }),
    );
  });

  it("freezes validation errors", () => {
    expect(
      Object.isFrozen(new MachinePowerPlanValidationError("invalid_record")),
    ).toBe(true);
  });
});
