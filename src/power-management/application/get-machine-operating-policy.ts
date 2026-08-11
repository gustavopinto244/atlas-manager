import type { MachineOperatingPolicy } from "../domain/machine-operating-policy.js";
import type { MachineOperatingPolicyStore } from "./ports/machine-operating-policy-store.js";

export type MachineOperatingPolicySource = "persisted" | "environment_default";

export interface GetMachineOperatingPolicyResult {
  readonly policy: MachineOperatingPolicy;
  readonly source: MachineOperatingPolicySource;
}

/**
 * Resolves the effective declared machine operating policy: the persisted
 * override when the store holds one, otherwise the ADR-012 environment
 * default. This is the read path `machine schedule show` (CLI, dashboard and
 * `/admin/overview`'s `machineSchedule` field) now uses -- see ADR-033. It
 * never influences the scheduler or confirmation reader, which continue to
 * use only the environment-parsed policy captured once at startup.
 */
export class GetMachineOperatingPolicy {
  readonly #store: MachineOperatingPolicyStore | undefined;
  readonly #environmentDefault: MachineOperatingPolicy;

  public constructor(
    environmentDefault: MachineOperatingPolicy,
    store?: MachineOperatingPolicyStore,
  ) {
    this.#store = store;
    this.#environmentDefault = environmentDefault;
    Object.freeze(this);
  }

  public async execute(): Promise<GetMachineOperatingPolicyResult> {
    const persisted = await this.#store?.find();
    if (persisted !== undefined && persisted !== null)
      return Object.freeze({ policy: persisted, source: "persisted" as const });
    return Object.freeze({
      policy: this.#environmentDefault,
      source: "environment_default" as const,
    });
  }
}
