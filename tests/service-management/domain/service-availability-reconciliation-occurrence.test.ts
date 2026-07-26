import { describe, expect, it, vi } from "vitest";

import {
  isSameServiceAvailabilityReconciliationOccurrence,
  ServiceAvailabilityReconciliationOccurrence,
  ServiceAvailabilityReconciliationOccurrenceValidationError,
  type CreateServiceAvailabilityReconciliationOccurrenceInput,
  type ServiceAvailabilityReconciliationOccurrenceValidationErrorCode,
} from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";

const scheduledFor = "2026-07-27T11:00:00.000Z";

function createOccurrence(
  input: Partial<CreateServiceAvailabilityReconciliationOccurrenceInput> = {},
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId: "atlas-api",
    operation: "start",
    scheduledFor,
    ...input,
  });
}

function expectValidationError(
  input: {
    readonly serviceId: unknown;
    readonly operation: unknown;
    readonly scheduledFor: unknown;
  },
  code: ServiceAvailabilityReconciliationOccurrenceValidationErrorCode,
): ServiceAvailabilityReconciliationOccurrenceValidationError {
  try {
    ServiceAvailabilityReconciliationOccurrence.create(
      input as CreateServiceAvailabilityReconciliationOccurrenceInput,
    );
  } catch (error) {
    expect(error).toBeInstanceOf(
      ServiceAvailabilityReconciliationOccurrenceValidationError,
    );
    expect(error).toEqual(
      expect.objectContaining({
        name: "ServiceAvailabilityReconciliationOccurrenceValidationError",
        code,
        message: `Invalid service availability reconciliation occurrence: ${code}`,
      }),
    );
    expect(error).not.toHaveProperty("cause");
    return error as ServiceAvailabilityReconciliationOccurrenceValidationError;
  }

  throw new Error("Expected occurrence validation to fail");
}

describe("ServiceAvailabilityReconciliationOccurrence", () => {
  it.each(["start", "stop"] as const)(
    "creates an immutable canonical %s occurrence",
    (operation) => {
      const input = {
        serviceId: "atlas-api",
        operation,
        scheduledFor,
      };
      const inputSnapshot = { ...input };
      const dateNow = vi.spyOn(Date, "now");

      const occurrence =
        ServiceAvailabilityReconciliationOccurrence.create(input);

      expect(occurrence).toEqual(input);
      expect(Object.keys(occurrence)).toEqual([
        "serviceId",
        "operation",
        "scheduledFor",
      ]);
      expect(Object.isFrozen(occurrence)).toBe(true);
      expect(input).toEqual(inputSnapshot);
      expect(dateNow).not.toHaveBeenCalled();

      dateNow.mockRestore();
    },
  );

  it("does not retain or mutate its constructor input", () => {
    const input = {
      serviceId: "atlas-api",
      operation: "start",
      scheduledFor,
    };
    const occurrence =
      ServiceAvailabilityReconciliationOccurrence.create(input);

    input.serviceId = "other-service";
    input.operation = "stop";
    input.scheduledFor = "2026-07-27T11:00:00.001Z";

    expect(occurrence).toEqual({
      serviceId: "atlas-api",
      operation: "start",
      scheduledFor,
    });
  });

  it.each(["a", "a".repeat(64), "atlas-api", "api2", "service-01"])(
    "accepts the canonical service identifier %s",
    (serviceId) => {
      expect(createOccurrence({ serviceId }).serviceId).toBe(serviceId);
    },
  );

  it.each([
    "",
    "a".repeat(65),
    "Atlas",
    "ATLAS",
    " atlas-api",
    "atlas-api ",
    "atlas_api",
    "atlas--api",
    "-atlas",
    "atlas-",
    "api/service",
    "pm2:atlas-api",
    undefined,
    null,
    true,
    false,
    0,
    1,
    {},
    [],
    new String("atlas-api"),
  ])("rejects the invalid service identifier %#", (serviceId) => {
    expectValidationError(
      { serviceId, operation: "start", scheduledFor },
      "invalid_service_id",
    );
  });

  it.each([
    "restart",
    "readStatus",
    "none",
    "execute",
    "start_if_needed",
    "stop_if_needed",
    "enable",
    "disable",
    "Start",
    "START",
    " start",
    "start ",
    "Stop",
    "STOP",
    "",
    undefined,
    null,
    true,
    false,
    0,
    1,
    {},
    [],
    new String("start"),
  ])("rejects the invalid operation %#", (operation) => {
    expectValidationError(
      { serviceId: "atlas-api", operation, scheduledFor },
      "invalid_operation",
    );
  });

  it.each([
    "2026-07-27T11:00:00.000Z",
    "2026-12-31T23:59:59.999Z",
    "1970-01-01T00:00:00.000Z",
  ])("accepts the canonical scheduled instant %s", (canonicalInstant) => {
    expect(
      createOccurrence({ scheduledFor: canonicalInstant }).scheduledFor,
    ).toBe(canonicalInstant);
  });

  it.each([
    "2026-07-27",
    "2026-07-27T11:00:00Z",
    "2026-07-27T08:00:00.000-03:00",
    "2026-07-27 11:00:00",
    "2026-07-27T11:00:00.000",
    "2026-07-27T11:00:00.000z",
    "2026-02-30T11:00:00.000Z",
    "invalid",
    "",
    undefined,
    null,
    true,
    false,
    0,
    1,
    {},
    [],
    new Date(scheduledFor),
    new String(scheduledFor),
  ])("rejects the non-canonical scheduled instant %#", (invalidInstant) => {
    expectValidationError(
      {
        serviceId: "atlas-api",
        operation: "start",
        scheduledFor: invalidInstant,
      },
      "invalid_scheduled_for",
    );
  });

  it("rejects missing runtime fields in validation order", () => {
    expectValidationError(
      {
        serviceId: undefined,
        operation: undefined,
        scheduledFor: undefined,
      },
      "invalid_service_id",
    );
    expectValidationError(
      {
        serviceId: "atlas-api",
        operation: undefined,
        scheduledFor: undefined,
      },
      "invalid_operation",
    );
    expectValidationError(
      {
        serviceId: "atlas-api",
        operation: "start",
        scheduledFor: undefined,
      },
      "invalid_scheduled_for",
    );
  });

  it.each(["start", "stop"] as const)(
    "prevents mutation of a %s occurrence",
    (operation) => {
      const occurrence = createOccurrence({ operation });

      expect(() => {
        (
          occurrence as {
            serviceId: string;
          }
        ).serviceId = "other-service";
      }).toThrow(TypeError);
      expect(() => {
        (
          occurrence as {
            operation: "start" | "stop";
          }
        ).operation = operation === "start" ? "stop" : "start";
      }).toThrow(TypeError);
      expect(() => {
        (
          occurrence as {
            scheduledFor: string;
          }
        ).scheduledFor = "2026-07-27T11:00:00.001Z";
      }).toThrow(TypeError);
      expect(() => {
        Object.assign(occurrence, { status: "completed" });
      }).toThrow(TypeError);
      expect(() => {
        delete (occurrence as { serviceId?: string }).serviceId;
      }).toThrow(TypeError);
    },
  );

  it("compares the exact canonical three-field identity tuple", () => {
    const first = createOccurrence();
    const second = createOccurrence();
    const third = createOccurrence();
    const otherService = createOccurrence({ serviceId: "atlas-worker" });
    const otherOperation = createOccurrence({ operation: "stop" });
    const otherInstant = createOccurrence({
      scheduledFor: "2026-07-27T11:00:00.001Z",
    });

    expect(first).not.toBe(second);
    expect(
      isSameServiceAvailabilityReconciliationOccurrence(first, first),
    ).toBe(true);
    expect(
      isSameServiceAvailabilityReconciliationOccurrence(first, second),
    ).toBe(true);
    expect(
      isSameServiceAvailabilityReconciliationOccurrence(second, first),
    ).toBe(true);
    expect(
      isSameServiceAvailabilityReconciliationOccurrence(second, third),
    ).toBe(true);
    expect(
      isSameServiceAvailabilityReconciliationOccurrence(first, third),
    ).toBe(true);
    expect(
      isSameServiceAvailabilityReconciliationOccurrence(first, otherService),
    ).toBe(false);
    expect(
      isSameServiceAvailabilityReconciliationOccurrence(first, otherOperation),
    ).toBe(false);
    expect(
      isSameServiceAvailabilityReconciliationOccurrence(first, otherInstant),
    ).toBe(false);
  });

  it("does not expose rejected sentinel values through validation errors", () => {
    const sentinel = "PRIVATE-occurrence-secret";
    const error = expectValidationError(
      {
        serviceId: sentinel,
        operation: "start",
        scheduledFor,
      },
      "invalid_service_id",
    );
    const serialized = JSON.stringify(error);

    expect(error.message).not.toContain(sentinel);
    expect(error.code).not.toContain(sentinel);
    expect(serialized).not.toContain(sentinel);
    expect(Object.keys(error).sort()).toEqual(["code", "name"]);
  });

  it("is deterministic and has no clock, timer, listener, or logging effects", () => {
    const dateNow = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const first = createOccurrence();
    const second = createOccurrence();
    const equal = isSameServiceAvailabilityReconciliationOccurrence(
      first,
      second,
    );

    expect(equal).toBe(true);
    expect(first).toEqual(second);
    expect(dateNow).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(processOnSpy).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();

    dateNow.mockRestore();
    setTimeoutSpy.mockRestore();
    processOnSpy.mockRestore();
    consoleLog.mockRestore();
  });
});
