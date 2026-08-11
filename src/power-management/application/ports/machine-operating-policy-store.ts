import type { MachineOperatingPolicy } from "../../domain/machine-operating-policy.js";

/**
 * Persists at most one declared machine operating policy, overlaying the
 * environment-owned default (`MACHINE_OPERATING_POLICY`, ADR-012) the same
 * way `ServiceAvailabilityPolicyStore` overlays a service's environment
 * catalog entry (ADR-029). See ADR-033.
 */
export interface MachineOperatingPolicyStore {
  find(): Promise<MachineOperatingPolicy | null>;
  save(policy: MachineOperatingPolicy): Promise<void>;
  remove(): Promise<void>;
}
