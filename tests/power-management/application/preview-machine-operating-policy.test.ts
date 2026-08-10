/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { PreviewMachineOperatingPolicy } from "../../../src/power-management/application/preview-machine-operating-policy.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import { MachineOperatingPolicyValidationError } from "../../../src/power-management/domain/machine-operating-policy.js";

const EVALUATED_AT = "2026-08-03T10:00:00.000Z";

function createClock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(EVALUATED_AT)) };
}

describe("PreviewMachineOperatingPolicy", () => {
  it("evaluates a candidate policy without persisting it, tagged as a candidate preview", () => {
    const clock = createClock();
    const useCase = new PreviewMachineOperatingPolicy(clock);

    const result = useCase.execute({ mode: "always_on" });

    expect(result).toEqual({
      evaluatedAt: EVALUATED_AT,
      expectation: "operating",
      nextShutdown: { state: "not_planned" },
      nextWake: { state: "not_planned" },
      source: "candidate_preview",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("evaluates a scheduled candidate policy", () => {
    const clock: PowerManagementClock = {
      now: vi.fn(() => new Date("2026-08-03T12:00:00.000Z")),
    };
    const useCase = new PreviewMachineOperatingPolicy(clock);

    const result = useCase.execute({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }],
      },
    });

    expect(result.source).toBe("candidate_preview");
    expect(result.expectation).toBe("operating");
  });

  it("rejects an invalid candidate policy using the domain validator", () => {
    const useCase = new PreviewMachineOperatingPolicy(createClock());

    expect(() => useCase.execute({ mode: "invalid" })).toThrow(
      MachineOperatingPolicyValidationError,
    );
  });

  it("never mutates any stored state -- it is a pure evaluation", () => {
    const clock = createClock();
    const useCase = new PreviewMachineOperatingPolicy(clock);

    useCase.execute({ mode: "manual" });
    useCase.execute({ mode: "always_on" });

    expect(clock.now).toHaveBeenCalledTimes(2);
  });
});
