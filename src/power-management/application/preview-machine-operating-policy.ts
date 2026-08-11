import type { PowerManagementClock } from "./ports/power-management-clock.js";
import { createMachineOperatingPolicy } from "../domain/machine-operating-policy.js";
import { evaluateMachinePowerPlan } from "../domain/machine-power-plan-evaluator.js";
import type { MachinePowerPlan } from "../domain/machine-power-plan.js";

export type PreviewMachineOperatingPolicyResult = MachinePowerPlan &
  Readonly<{ source: "candidate_preview" }>;

/**
 * Evaluates a candidate (unsaved) machine operating policy "as of now"
 * without persisting it, reusing the same domain validation
 * (`createMachineOperatingPolicy`) and evaluator (`evaluateMachinePowerPlan`)
 * the authoritative read and scheduler paths already use, so the browser and
 * CLI never compute a plan themselves. Mirrors
 * `PreviewRegisteredServiceAvailabilityPolicy`; unlike the service preview
 * there is no override store or interval to combine, since the machine has
 * one policy and the evaluator already reports the next transition from
 * "now".
 */
export class PreviewMachineOperatingPolicy {
  readonly #clock: PowerManagementClock;

  public constructor(clock: PowerManagementClock) {
    this.#clock = clock;
    Object.freeze(this);
  }

  public execute(
    candidatePolicy: unknown,
  ): PreviewMachineOperatingPolicyResult {
    const policy = createMachineOperatingPolicy(candidatePolicy);
    const evaluatedAt = this.#clock.now().toISOString();
    const plan = evaluateMachinePowerPlan(policy, evaluatedAt);
    return Object.freeze({ ...plan, source: "candidate_preview" as const });
  }
}
