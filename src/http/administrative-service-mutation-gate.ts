import type { AdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";
import { FixedAdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";

export type AdministrativeServiceMutationGate =
  AdministrativePowerOperationGate;

export function createAdministrativeServiceMutationGate(): AdministrativeServiceMutationGate {
  return new FixedAdministrativePowerOperationGate();
}
