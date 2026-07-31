/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { RequestMachineShutdown } from "../../../src/power-management/application/request-machine-shutdown.js";
import type { MachineShutdownController } from "../../../src/power-management/application/ports/machine-shutdown-controller.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";

const REQUESTED_AT = "2026-07-31T12:00:00.000Z";
const RESULT = createMachineShutdownResult({
  operation: "shutdown",
  requestedAt: REQUESTED_AT,
  outcome: "simulated",
});

function createClock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(REQUESTED_AT)) };
}

describe("RequestMachineShutdown", () => {
  it("captures one request instant and calls the controller exactly once", async () => {
    const clock = createClock();
    const controller: MachineShutdownController = {
      requestShutdown: vi.fn().mockResolvedValue(RESULT),
    };
    const useCase = new RequestMachineShutdown(clock, controller);

    expect(await useCase.execute()).toBe(RESULT);
    expect(clock.now).toHaveBeenCalledOnce();
    expect(controller.requestShutdown).toHaveBeenCalledOnce();
    expect(controller.requestShutdown).toHaveBeenCalledWith(REQUESTED_AT);
  });

  it("preserves controller rejection without retry, fallback, or compensation", async () => {
    const failure = new Error("shutdown-controller-failure");
    const clock = createClock();
    const controller: MachineShutdownController = {
      requestShutdown: vi.fn().mockRejectedValue(failure),
    };
    const useCase = new RequestMachineShutdown(clock, controller);

    await expect(useCase.execute()).rejects.toBe(failure);
    expect(clock.now).toHaveBeenCalledOnce();
    expect(controller.requestShutdown).toHaveBeenCalledOnce();
  });

  it("performs no shutdown request during construction", () => {
    const controller: MachineShutdownController = {
      requestShutdown: vi.fn(),
    };

    new RequestMachineShutdown(createClock(), controller);

    expect(controller.requestShutdown).not.toHaveBeenCalled();
  });
});
