import { describe, expect, it } from "vitest";
import {
  createMachinePowerSchedulerCursor,
  isSameMachinePowerSchedulerCursor,
} from "../../../src/power-management/domain/machine-power-scheduler-cursor.js";
import { createMachineShutdownOccurrencesForInterval } from "../../../src/power-management/domain/machine-shutdown-occurrence-interval.js";
import { createMachinePowerSchedulerReport } from "../../../src/power-management/domain/machine-power-scheduler-report.js";
import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";

const policy = createMachineOperatingPolicy({
  mode: "scheduled" as const,
  timezone: "America/Sao_Paulo",
  weeklySchedule: {
    windows: [
      { dayOfWeek: "monday", start: "08:00", end: "18:00" },
      { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
    ],
  },
});
describe("machine power scheduler domain", () => {
  it("creates immutable cursors and compares by completedThrough", () => {
    const cursor = createMachinePowerSchedulerCursor({
      completedThrough: "2026-08-03T13:00:00.000Z",
    });
    expect(Object.isFrozen(cursor)).toBe(true);
    expect(isSameMachinePowerSchedulerCursor(cursor, { ...cursor })).toBe(true);
    expect(() =>
      createMachinePowerSchedulerCursor({ completedThrough: "bad" }),
    ).toThrow();
  });
  it("generates the ending transition in the half-open interval", () => {
    const occurrences = createMachineShutdownOccurrencesForInterval(
      policy,
      "2026-08-03T20:59:00.000Z",
      "2026-08-03T21:00:00.000Z",
    );
    expect(occurrences).toEqual([
      {
        operation: "shutdown",
        scheduledFor: "2026-08-03T21:00:00.000Z",
        wakeScheduledFor: "2026-08-04T12:00:00.000Z",
      },
    ]);
    expect(Object.isFrozen(occurrences)).toBe(true);
    expect(
      createMachineShutdownOccurrencesForInterval(
        policy,
        "2026-08-03T21:00:00.000Z",
        "2026-08-03T21:00:00.000Z",
      ),
    ).toEqual([]);
  });
  it("keeps adjacent windows as one period and does not generate for non-scheduled policies", () => {
    const adjacent = createMachineOperatingPolicy({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [
          { dayOfWeek: "monday", start: "08:00", end: "12:00" },
          { dayOfWeek: "monday", start: "12:00", end: "18:00" },
          { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
        ],
      },
    });
    expect(
      createMachineShutdownOccurrencesForInterval(
        adjacent,
        "2026-08-03T11:59:00.000Z",
        "2026-08-03T21:00:00.000Z",
      ),
    ).toHaveLength(1);
    expect(
      createMachineShutdownOccurrencesForInterval(
        createMachineOperatingPolicy({ mode: "always_on" }),
        "2026-08-03T00:00:00.000Z",
        "2026-08-03T01:00:00.000Z",
      ),
    ).toEqual([]);
    expect(() =>
      createMachineShutdownOccurrencesForInterval(
        policy,
        "2026-08-04T00:00:00.000Z",
        "2026-08-03T00:00:00.000Z",
      ),
    ).toThrow();
  });
  it("creates complete and incomplete immutable reports", () => {
    const report = createMachinePowerSchedulerReport({
      completedThrough: "2026-08-03T20:59:00.000Z",
      tickedThrough: "2026-08-03T21:00:00.000Z",
      occurrenceResults: [],
      complete: true,
    });
    expect(report.complete).toBe(true);
    expect(Object.isFrozen(report)).toBe(true);
  });
});
