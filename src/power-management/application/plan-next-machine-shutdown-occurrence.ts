import {
  planMachineShutdownOccurrence,
  type MachineShutdownOccurrencePlan,
} from "../domain/machine-shutdown-occurrence-plan.js";

export interface MachinePowerPlanCapability {
  execute(): unknown;
}
export class PlanNextMachineShutdownOccurrence {
  readonly #powerPlan: MachinePowerPlanCapability;
  public constructor(powerPlan: MachinePowerPlanCapability) {
    this.#powerPlan = powerPlan;
    Object.freeze(this);
  }
  public execute(): MachineShutdownOccurrencePlan {
    return planMachineShutdownOccurrence(this.#powerPlan.execute());
  }
}
