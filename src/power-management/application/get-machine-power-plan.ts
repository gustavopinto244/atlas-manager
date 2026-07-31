import type { PowerManagementClock } from "./ports/power-management-clock.js";
import {
  createMachineOperatingPolicy,
  type MachineOperatingPolicy,
} from "../domain/machine-operating-policy.js";
import { evaluateMachinePowerPlan } from "../domain/machine-power-plan-evaluator.js";
import type { MachinePowerPlan } from "../domain/machine-power-plan.js";

export class GetMachinePowerPlan {
  readonly #clock: PowerManagementClock;
  readonly #policy: MachineOperatingPolicy;

  public constructor(clock: PowerManagementClock, policy: unknown) {
    this.#clock = clock;
    this.#policy = createMachineOperatingPolicy(policy);
    Object.freeze(this);
  }

  public execute(): MachinePowerPlan {
    const evaluatedAt = this.#clock.now().toISOString();
    return evaluateMachinePowerPlan(this.#policy, evaluatedAt);
  }
}
