import { describe, expect, it } from "vitest";

import {
  createMachineShutdownResult,
  MachineShutdownResultValidationError,
} from "../../../src/power-management/domain/machine-shutdown-result.js";

const REQUESTED_AT = "2026-07-31T12:00:00.000Z";

function expectValidationError(input: unknown, code: string): void {
  expect(() => createMachineShutdownResult(input)).toThrowError(
    expect.objectContaining({
      name: "MachineShutdownResultValidationError",
      code,
    }),
  );
}

describe("machine shutdown result", () => {
  it("creates an immutable simulated shutdown result", () => {
    const result = createMachineShutdownResult({
      operation: "shutdown",
      requestedAt: REQUESTED_AT,
      outcome: "simulated",
    });

    expect(result).toEqual({
      operation: "shutdown",
      requestedAt: REQUESTED_AT,
      outcome: "simulated",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    [
      "a restart operation",
      { operation: "restart", requestedAt: REQUESTED_AT, outcome: "simulated" },
      "invalid_operation",
    ],
    [
      "a completed outcome",
      {
        operation: "shutdown",
        requestedAt: REQUESTED_AT,
        outcome: "completed",
      },
      "invalid_outcome",
    ],
    [
      "a malformed timestamp",
      { operation: "shutdown", requestedAt: "now", outcome: "simulated" },
      "invalid_requested_at",
    ],
    [
      "an unknown field",
      {
        operation: "shutdown",
        requestedAt: REQUESTED_AT,
        outcome: "simulated",
        command: "poweroff",
      },
      "invalid_field",
    ],
  ] as const)("rejects %s", (_label, input, code) => {
    expectValidationError(input, code);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "shutdown"],
    ["a number", 42],
  ])("rejects %s as a non-record", (_label, input) => {
    expectValidationError(input, "invalid_record");
  });

  it("freezes its validation error and exposes no command details", () => {
    expect(
      Object.isFrozen(
        new MachineShutdownResultValidationError("invalid_field"),
      ),
    ).toBe(true);
    try {
      createMachineShutdownResult({
        operation: "shutdown",
        requestedAt: REQUESTED_AT,
        outcome: "simulated",
        command: "poweroff --now",
      });
    } catch (error) {
      expect(String(error)).not.toContain("poweroff --now");
    }
  });
});
