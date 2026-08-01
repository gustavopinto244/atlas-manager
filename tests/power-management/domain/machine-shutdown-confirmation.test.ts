import { describe, expect, it } from "vitest";

import {
  createMachineShutdownConfirmation,
  MachineShutdownConfirmationValidationError,
} from "../../../src/power-management/domain/machine-shutdown-confirmation.js";

describe("machine shutdown confirmations", () => {
  it("creates immutable stage values from exact literals", () => {
    const preparation = createMachineShutdownConfirmation(
      "confirm_shutdown_preparation",
    );
    const execution = createMachineShutdownConfirmation(
      "confirm_shutdown_execution",
    );

    expect(preparation).toEqual({ stage: "preparation" });
    expect(execution).toEqual({ stage: "execution" });
    expect(Object.isFrozen(preparation)).toBe(true);
    expect(Object.isFrozen(execution)).toBe(true);
  });

  it.each([
    "confirm_shutdown",
    "CONFIRM_SHUTDOWN_EXECUTION",
    " confirm_shutdown_execution",
    true,
    null,
  ])("rejects non-exact confirmation %j", (value) => {
    expect(() => createMachineShutdownConfirmation(value)).toThrow(
      MachineShutdownConfirmationValidationError,
    );
  });
});
