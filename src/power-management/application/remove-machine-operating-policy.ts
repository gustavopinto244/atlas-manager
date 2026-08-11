import type { MachineOperatingPolicyStore } from "./ports/machine-operating-policy-store.js";

/**
 * Removes the persisted machine operating policy override. Once removed,
 * `GetMachineOperatingPolicy` falls back to the environment default on the
 * very next read -- no restart required. Mirrors
 * `RemoveRegisteredServiceAvailabilityPolicy`. See ADR-033.
 */
export class RemoveMachineOperatingPolicy {
  readonly #store: MachineOperatingPolicyStore;

  public constructor(store: MachineOperatingPolicyStore) {
    this.#store = store;
    Object.freeze(this);
  }

  public async execute(): Promise<void> {
    await this.#store.remove();
  }
}
