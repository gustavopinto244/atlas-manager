import type { MachineOperatingPolicy } from "../domain/machine-operating-policy.js";
import type { MachineOperatingPolicyStore } from "../application/ports/machine-operating-policy-store.js";

export class InMemoryMachineOperatingPolicyStore implements MachineOperatingPolicyStore {
  #policy: MachineOperatingPolicy | null = null;

  public find(): Promise<MachineOperatingPolicy | null> {
    return Promise.resolve(this.#policy);
  }

  public save(policy: MachineOperatingPolicy): Promise<void> {
    this.#policy = policy;
    return Promise.resolve();
  }

  public remove(): Promise<void> {
    this.#policy = null;
    return Promise.resolve();
  }
}
