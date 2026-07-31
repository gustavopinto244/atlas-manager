import { describe, expect, it } from "vitest";
import {
  createMachineShutdownOccurrence,
  MachineShutdownOccurrenceValidationError,
} from "../../../src/power-management/domain/machine-shutdown-occurrence.js";
import {
  createMachineShutdownOccurrencePlan,
  planMachineShutdownOccurrence,
} from "../../../src/power-management/domain/machine-shutdown-occurrence-plan.js";

const SHUTDOWN = "2026-08-03T21:00:00.000Z";
const WAKE = "2026-08-04T12:00:00.000Z";
const POWER_PLAN = {
  evaluatedAt: "2026-08-03T13:00:00.000Z",
  expectation: "operating",
  nextShutdown: { state: "planned", scheduledFor: SHUTDOWN },
  nextWake: { state: "planned", scheduledFor: WAKE },
} as const;

describe("machine shutdown occurrence", () => {
  it("creates an immutable canonical occurrence and uses the complete tuple as identity", () => {
    const input = {
      operation: "shutdown" as const,
      scheduledFor: SHUTDOWN,
      wakeScheduledFor: WAKE,
    };
    const occurrence = createMachineShutdownOccurrence(input);
    expect(occurrence).toEqual(input);
    expect(Object.isFrozen(occurrence)).toBe(true);
    input.scheduledFor = "2026-08-03T20:00:00.000Z";
    expect(occurrence.scheduledFor).toBe(SHUTDOWN);
  });

  it.each([
    [
      {
        operation: "shutdown",
        scheduledFor: SHUTDOWN,
        wakeScheduledFor: SHUTDOWN,
      },
      "invalid_timestamp_order",
    ],
    [
      { operation: "shutdown", scheduledFor: "bad", wakeScheduledFor: WAKE },
      "invalid_scheduled_for",
    ],
    [
      {
        operation: "shutdown",
        scheduledFor: SHUTDOWN,
        wakeScheduledFor: "2026-08-03T20:00:00.000Z",
      },
      "invalid_timestamp_order",
    ],
    [
      {
        operation: "shutdown",
        scheduledFor: SHUTDOWN,
        wakeScheduledFor: WAKE,
        extra: true,
      },
      "invalid_field",
    ],
  ] as const)("rejects invalid occurrence (%s)", (input, code) => {
    expect(() => createMachineShutdownOccurrence(input)).toThrowError(
      expect.objectContaining({
        name: "MachineShutdownOccurrenceValidationError",
        code,
      }),
    );
  });

  it("converts only an operating scheduled plan into one shutdown occurrence", () => {
    const planned = planMachineShutdownOccurrence(POWER_PLAN);
    expect(planned).toEqual({
      state: "planned",
      occurrence: {
        operation: "shutdown",
        scheduledFor: SHUTDOWN,
        wakeScheduledFor: WAKE,
      },
    });
    expect(Object.isFrozen(planned)).toBe(true);
    expect(
      planned.state === "planned" && Object.isFrozen(planned.occurrence),
    ).toBe(true);
    expect(
      planMachineShutdownOccurrence({
        ...POWER_PLAN,
        expectation: "manual",
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "not_planned" },
      }),
    ).toEqual({ state: "not_planned" });
    expect(
      planMachineShutdownOccurrence({
        ...POWER_PLAN,
        expectation: "offline",
        nextShutdown: { state: "planned", scheduledFor: WAKE },
        nextWake: {
          state: "planned",
          scheduledFor: "2026-08-04T09:00:00.000Z",
        },
      }),
    ).toEqual({ state: "not_planned" });
    expect(
      planMachineShutdownOccurrence({
        ...POWER_PLAN,
        expectation: "operating",
        nextShutdown: { state: "not_planned" },
        nextWake: { state: "not_planned" },
      }),
    ).toEqual({ state: "not_planned" });
  });

  it("validates planned and not-planned occurrence results", () => {
    expect(
      createMachineShutdownOccurrencePlan({ state: "not_planned" }),
    ).toEqual({ state: "not_planned" });
    expect(() =>
      createMachineShutdownOccurrencePlan({
        state: "not_planned",
        occurrence: {},
      }),
    ).toThrow();
    expect(() =>
      createMachineShutdownOccurrencePlan({ state: "planned" }),
    ).toThrow();
  });

  it("freezes validation errors", () => {
    expect(
      Object.isFrozen(
        new MachineShutdownOccurrenceValidationError("invalid_record"),
      ),
    ).toBe(true);
  });
});
