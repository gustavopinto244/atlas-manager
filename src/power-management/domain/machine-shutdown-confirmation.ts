export const MACHINE_SHUTDOWN_CONFIRMATION_STAGES = Object.freeze([
  "preparation",
  "execution",
] as const);

export type MachineShutdownConfirmationStage =
  (typeof MACHINE_SHUTDOWN_CONFIRMATION_STAGES)[number];

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
    input !== "confirm_shutdown_preparation" &&
    input !== "confirm_shutdown_execution"
  )
    throw new MachineShutdownConfirmationValidationError();
  return Object.freeze({
    stage:
      input === "confirm_shutdown_preparation"
        ? ("preparation" as const)
        : ("execution" as const),
  });
}
