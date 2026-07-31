import { describe, expect, it } from "vitest";

import {
  createWakeAlarmMutationResult,
  WakeAlarmMutationResultValidationError,
} from "../../../src/power-management/domain/wake-alarm-mutation-result.js";

const REQUESTED_AT = "2026-07-31T12:00:00.000Z";
const T1 = "2026-08-01T06:00:00.000Z";
const T2 = "2026-08-02T06:00:00.000Z";

describe("wake-alarm mutation result", () => {
  it.each([
    [
      "scheduled",
      "schedule",
      { state: "not_scheduled" },
      { state: "scheduled", scheduledFor: T1 },
    ],
    [
      "replaced",
      "schedule",
      { state: "scheduled", scheduledFor: T1 },
      { state: "scheduled", scheduledFor: T2 },
    ],
    [
      "unchanged",
      "schedule",
      { state: "scheduled", scheduledFor: T1 },
      { state: "scheduled", scheduledFor: T1 },
    ],
    [
      "cancelled",
      "cancel",
      { state: "scheduled", scheduledFor: T1 },
      { state: "not_scheduled" },
    ],
    [
      "not_scheduled",
      "cancel",
      { state: "not_scheduled" },
      { state: "not_scheduled" },
    ],
  ] as const)(
    "accepts the %s transition",
    (outcome, operation, before, after) => {
      const result = createWakeAlarmMutationResult({
        operation,
        requestedAt: REQUESTED_AT,
        outcome,
        before,
        after,
      });

      expect(result).toEqual({
        operation,
        requestedAt: REQUESTED_AT,
        outcome,
        before,
        after,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.before)).toBe(true);
      expect(Object.isFrozen(result.after)).toBe(true);
    },
  );

  it.each([
    [
      "schedule with cancelled",
      {
        operation: "schedule",
        outcome: "cancelled",
        before: { state: "scheduled", scheduledFor: T1 },
        after: { state: "not_scheduled" },
      },
    ],
    [
      "cancel with scheduled",
      {
        operation: "cancel",
        outcome: "scheduled",
        before: { state: "not_scheduled" },
        after: { state: "scheduled", scheduledFor: T1 },
      },
    ],
    [
      "replacement with equal timestamps",
      {
        operation: "schedule",
        outcome: "replaced",
        before: { state: "scheduled", scheduledFor: T1 },
        after: { state: "scheduled", scheduledFor: T1 },
      },
    ],
    [
      "unchanged with different timestamps",
      {
        operation: "schedule",
        outcome: "unchanged",
        before: { state: "scheduled", scheduledFor: T1 },
        after: { state: "scheduled", scheduledFor: T2 },
      },
    ],
    [
      "schedule producing not scheduled",
      {
        operation: "schedule",
        outcome: "scheduled",
        before: { state: "not_scheduled" },
        after: { state: "not_scheduled" },
      },
    ],
    [
      "cancellation leaving scheduled",
      {
        operation: "cancel",
        outcome: "cancelled",
        before: { state: "scheduled", scheduledFor: T1 },
        after: { state: "scheduled", scheduledFor: T2 },
      },
    ],
  ] as const)("rejects %s", (_label, partial) => {
    expect(() =>
      createWakeAlarmMutationResult({ requestedAt: REQUESTED_AT, ...partial }),
    ).toThrowError(
      expect.objectContaining({
        name: "WakeAlarmMutationResultValidationError",
        code: "invalid_transition",
      }),
    );
  });

  it.each([
    [
      "unsupported before",
      { state: "unsupported" },
      { state: "not_scheduled" },
    ],
    ["unsupported after", { state: "not_scheduled" }, { state: "unsupported" }],
  ] as const)("rejects %s successful state", (_label, before, after) => {
    expect(() =>
      createWakeAlarmMutationResult({
        operation: "cancel",
        requestedAt: REQUESTED_AT,
        outcome: "not_scheduled",
        before,
        after,
      }),
    ).toThrowError(expect.objectContaining({ code: "unsupported_state" }));
  });

  it("rejects malformed records, timestamps, fields, and states", () => {
    expect(() => createWakeAlarmMutationResult(null)).toThrowError(
      expect.objectContaining({ code: "invalid_record" }),
    );
    expect(() =>
      createWakeAlarmMutationResult({
        operation: "schedule",
        requestedAt: REQUESTED_AT,
        outcome: "scheduled",
        before: { state: "not_scheduled" },
        after: { state: "scheduled", scheduledFor: T1 },
        extra: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_field" }));
    expect(() =>
      createWakeAlarmMutationResult({
        operation: "schedule",
        requestedAt: "bad",
        outcome: "scheduled",
        before: { state: "not_scheduled" },
        after: { state: "scheduled", scheduledFor: T1 },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_requested_at" }));
    expect(() =>
      createWakeAlarmMutationResult({
        operation: "schedule",
        requestedAt: REQUESTED_AT,
        outcome: "scheduled",
        before: { state: "bad" },
        after: { state: "scheduled", scheduledFor: T1 },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_before" }));
    expect(
      Object.isFrozen(
        new WakeAlarmMutationResultValidationError("invalid_record"),
      ),
    ).toBe(true);
  });

  it("isolates caller-owned nested states", () => {
    const before = { state: "scheduled", scheduledFor: T1 };
    const after = { state: "scheduled", scheduledFor: T2 };
    const result = createWakeAlarmMutationResult({
      operation: "schedule",
      requestedAt: REQUESTED_AT,
      outcome: "replaced",
      before,
      after,
    });

    before.scheduledFor = "2027-01-01T00:00:00.000Z";
    after.scheduledFor = "2027-01-02T00:00:00.000Z";

    expect(result.before).toEqual({ state: "scheduled", scheduledFor: T1 });
    expect(result.after).toEqual({ state: "scheduled", scheduledFor: T2 });
  });
});
