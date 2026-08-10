import {
  createMachineOperatingPolicy,
  type MachineOperatingPolicy,
} from "../domain/machine-operating-policy.js";
import type { MachineOperatingPolicyStore } from "./ports/machine-operating-policy-store.js";

/**
 * Persists a new declared machine operating policy, overriding the
 * environment default for every subsequent `GetMachineOperatingPolicy` read.
 * Mirrors `UpdateRegisteredServiceAvailabilityPolicy`. Never influences the
 * scheduler or confirmation reader -- see ADR-033.
 */
export class SetMachineOperatingPolicy {
  readonly #store: MachineOperatingPolicyStore;

  public constructor(store: MachineOperatingPolicyStore) {
    this.#store = store;
    Object.freeze(this);
  }

  public async execute(input: unknown): Promise<MachineOperatingPolicy> {
    const policy = createMachineOperatingPolicy(input);
    await this.#store.save(policy);
    return policy;
  }
}
