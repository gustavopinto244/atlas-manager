export const MACHINE_SHUTDOWN_CONFIRMATION_STAGES = Object.freeze([
  "preparation",
  "execution",
] as const);

export type MachineShutdownConfirmationStage =
  (typeof MACHINE_SHUTDOWN_CONFIRMATION_STAGES)[number];

export const MACHINE_SHUTDOWN_PREPARATION_CONFIRMATION =
  "confirm_shutdown_preparation";
export const MACHINE_SHUTDOWN_EXECUTION_CONFIRMATION =
  "confirm_shutdown_execution";

export interface MachineShutdownConfirmation {
  readonly stage: MachineShutdownConfirmationStage;
}

export class MachineShutdownConfirmationValidationError extends Error {
  public override readonly name = "MachineShutdownConfirmationValidationError";
  public constructor() {
    super("Invalid machine shutdown confirmation");
    Object.freeze(this);
  }
}

export function createMachineShutdownConfirmation(
  input: unknown,
): MachineShutdownConfirmation {
  if (
    input !== MACHINE_SHUTDOWN_PREPARATION_CONFIRMATION &&
    input !== MACHINE_SHUTDOWN_EXECUTION_CONFIRMATION
  )
    throw new MachineShutdownConfirmationValidationError();
  return Object.freeze({
    stage:
      input === MACHINE_SHUTDOWN_PREPARATION_CONFIRMATION
        ? ("preparation" as const)
        : ("execution" as const),
  });
}
