import {
  FixedAdministrativePowerOperationGate,
  type AdministrativePowerOperationGate,
} from "./administrative-power-operation-gate.js";

/** @deprecated Use the shared administrative power-operation gate. */
export type AdministrativeWakeAlarmMutationGate =
  AdministrativePowerOperationGate;

/** @deprecated Use FixedAdministrativePowerOperationGate. */
export class FixedAdministrativeWakeAlarmMutationGate extends FixedAdministrativePowerOperationGate {}
