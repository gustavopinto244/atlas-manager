/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { GetMachinePowerPlan } from "../../../src/power-management/application/get-machine-power-plan.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";

const EVALUATED_AT = "2026-08-03T10:00:00.000Z";

function createClock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(EVALUATED_AT)) };
}

const scheduledPolicy = {
  mode: "scheduled" as const,
  timezone: "America/Sao_Paulo",
  weeklySchedule: {
    windows: [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }],
  },
};

describe("GetMachinePowerPlan", () => {
  it("does not read the clock during construction and reads it once per execution", () => {
    const clock = createClock();
    const useCase = new GetMachinePowerPlan(clock, { mode: "always_on" });

    expect(clock.now).not.toHaveBeenCalled();
    const result = useCase.execute();

    expect(clock.now).toHaveBeenCalledOnce();
    expect(result).toEqual({
      evaluatedAt: EVALUATED_AT,
      expectation: "operating",
      nextShutdown: { state: "not_planned" },
      nextWake: { state: "not_planned" },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["always_on", { mode: "always_on" }, "operating"],
    ["manual", { mode: "manual" }, "manual"],
    ["scheduled", scheduledPolicy, "operating"],
  ] as const)("evaluates %s", (_label, policy, expectation) => {
    const clock =
      _label === "scheduled"
        ? { now: vi.fn(() => new Date("2026-08-03T12:00:00.000Z")) }
        : createClock();
    const result = new GetMachinePowerPlan(clock, policy).execute();
    expect(result.expectation).toBe(expectation);
  });

  it("evaluates an offline scheduled instant with the captured time", () => {
    const clock: PowerManagementClock = {
      now: vi.fn(() => new Date("2026-08-03T22:00:00.000Z")),
    };
    const result = new GetMachinePowerPlan(clock, scheduledPolicy).execute();

    expect(result).toMatchObject({
      evaluatedAt: "2026-08-03T22:00:00.000Z",
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

  it("retains an immutable policy snapshot", () => {
    const input = {
      mode: "scheduled" as const,
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }],
      },
    };
    const useCase = new GetMachinePowerPlan(createClock(), input);
    input.weeklySchedule.windows[0]!.start = "12:00";

    expect(useCase.execute().nextShutdown).toEqual({
      state: "planned",
      scheduledFor: "2026-08-03T21:00:00.000Z",
    });
  });

  it("performs no mutation or retry behavior", () => {
    const clock = createClock();
    const useCase = new GetMachinePowerPlan(
      clock,
      createMachineOperatingPolicy({ mode: "manual" }),
    );

    expect(() => useCase.execute()).not.toThrow();
    expect(clock.now).toHaveBeenCalledOnce();
  });
});
