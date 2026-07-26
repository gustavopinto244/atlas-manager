import { describe, expect, it } from "vitest";

import {
  isSameServiceAvailabilityReconciliationSchedulerCursor,
  ServiceAvailabilityReconciliationSchedulerCursor,
  ServiceAvailabilityReconciliationSchedulerCursorValidationError,
  type CreateServiceAvailabilityReconciliationSchedulerCursorInput,
} from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";

const completedThrough = "2026-07-26T12:30:00.000Z";

function createCursor(
  value = completedThrough,
): ServiceAvailabilityReconciliationSchedulerCursor {
  return ServiceAvailabilityReconciliationSchedulerCursor.create({
    completedThrough: value,
  });
}

function expectValidationError(
  value: unknown,
): ServiceAvailabilityReconciliationSchedulerCursorValidationError {
  try {
    ServiceAvailabilityReconciliationSchedulerCursor.create({
      completedThrough: value,
    } as CreateServiceAvailabilityReconciliationSchedulerCursorInput);
  } catch (error) {
    expect(error).toBeInstanceOf(
      ServiceAvailabilityReconciliationSchedulerCursorValidationError,
    );
    expect(error).toEqual(
      expect.objectContaining({
        name: "ServiceAvailabilityReconciliationSchedulerCursorValidationError",
        code: "invalid_completed_through",
        message:
          "Invalid service availability reconciliation scheduler cursor: invalid_completed_through",
      }),
    );
    expect(error).not.toHaveProperty("cause");
    return error as ServiceAvailabilityReconciliationSchedulerCursorValidationError;
  }

  throw new Error("Expected cursor validation to fail");
}

describe("ServiceAvailabilityReconciliationSchedulerCursor", () => {
  it("creates an exact frozen canonical UTC-minute cursor", () => {
    const input = { completedThrough };
    const cursor =
      ServiceAvailabilityReconciliationSchedulerCursor.create(input);

    expect(cursor).toEqual({ completedThrough });
    expect(Object.keys(cursor)).toEqual(["completedThrough"]);
    expect(Object.isFrozen(cursor)).toBe(true);
    expect(input).toEqual({ completedThrough });
  });

  it.each([
    "",
    "invalid",
    "2026-07-26",
    "2026-07-26T12:30:00Z",
    "2026-07-26T09:30:00.000-03:00",
    "2026-07-26T12:30:00.000",
    "2026-07-26T12:30:00.000z",
    "2026-07-26T12:30:01.000Z",
    "2026-07-26T12:30:00.001Z",
    " 2026-07-26T12:30:00.000Z",
    "2026-07-26T12:30:00.000Z ",
    undefined,
    null,
    true,
    false,
    0,
    {},
    [],
    new Date(completedThrough),
    new String(completedThrough),
  ])("rejects the invalid completed-through value %#", (value) => {
    const error = expectValidationError(value);

    expect(Object.keys(error)).toEqual(["code", "name"]);
  });

  it("rejects a missing or malformed runtime input object safely", () => {
    expect(() =>
      ServiceAvailabilityReconciliationSchedulerCursor.create(
        undefined as unknown as CreateServiceAvailabilityReconciliationSchedulerCursorInput,
      ),
    ).toThrowError(
      ServiceAvailabilityReconciliationSchedulerCursorValidationError,
    );
    expect(() =>
      ServiceAvailabilityReconciliationSchedulerCursor.create(
        null as unknown as CreateServiceAvailabilityReconciliationSchedulerCursorInput,
      ),
    ).toThrowError(
      ServiceAvailabilityReconciliationSchedulerCursorValidationError,
    );
  });

  it("prevents replacing, adding, or deleting properties", () => {
    const cursor = createCursor();

    expect(Reflect.set(cursor, "completedThrough", "changed")).toBe(false);
    expect(Reflect.set(cursor, "metadata", "private")).toBe(false);
    expect(Reflect.deleteProperty(cursor, "completedThrough")).toBe(false);
    expect(cursor).toEqual({ completedThrough });
  });

  it("compares cursors by canonical value and handles null", () => {
    const first = createCursor();
    const equivalent = createCursor();
    const different = createCursor("2026-07-26T12:31:00.000Z");

    expect(
      isSameServiceAvailabilityReconciliationSchedulerCursor(first, first),
    ).toBe(true);
    expect(
      isSameServiceAvailabilityReconciliationSchedulerCursor(first, equivalent),
    ).toBe(true);
    expect(
      isSameServiceAvailabilityReconciliationSchedulerCursor(first, different),
    ).toBe(false);
    expect(
      isSameServiceAvailabilityReconciliationSchedulerCursor(null, null),
    ).toBe(true);
    expect(
      isSameServiceAvailabilityReconciliationSchedulerCursor(first, null),
    ).toBe(false);
    expect(
      isSameServiceAvailabilityReconciliationSchedulerCursor(null, first),
    ).toBe(false);
  });
});
