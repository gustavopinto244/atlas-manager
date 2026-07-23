import { describe, expect, it } from "vitest";

import {
  RegisteredServiceStatus,
  RegisteredServiceStatusValidationError,
  SERVICE_RUNTIME_STATES,
  type RegisteredServiceStatusValidationErrorCode,
} from "../../../src/service-management/domain/registered-service-status.js";

const observedAt = "2026-07-23T12:00:00.000Z";

function expectValidationError(
  input: Parameters<typeof RegisteredServiceStatus.create>[0],
  code: RegisteredServiceStatusValidationErrorCode,
): void {
  expect(() => RegisteredServiceStatus.create(input)).toThrowError(
    expect.objectContaining({
      name: "RegisteredServiceStatusValidationError",
      code,
    }),
  );
}

describe("RegisteredServiceStatus", () => {
  it.each(SERVICE_RUNTIME_STATES)(
    "creates an immutable %s status with a canonical UTC timestamp",
    (state) => {
      const status = RegisteredServiceStatus.create({
        serviceId: "task-manager",
        state,
        observedAt,
      });

      expect(status).toEqual({
        serviceId: "task-manager",
        state,
        observedAt,
      });
      expect(Object.isFrozen(status)).toBe(true);
    },
  );

  it("defines exactly the approved runtime states", () => {
    expect(SERVICE_RUNTIME_STATES).toEqual([
      "running",
      "stopped",
      "failed",
      "unknown",
    ]);
    expect(Object.isFrozen(SERVICE_RUNTIME_STATES)).toBe(true);
  });

  it("rejects an unsupported runtime state", () => {
    expectValidationError(
      {
        serviceId: "task-manager",
        state: "starting",
        observedAt,
      },
      "invalid_service_status",
    );
  });

  it.each([
    ["an invalid timestamp", "not-a-date"],
    ["a non-UTC timestamp", "2026-07-23T09:00:00.000-03:00"],
    ["a non-canonical UTC timestamp", "2026-07-23T12:00:00Z"],
  ])("rejects %s", (_description, invalidObservedAt) => {
    expectValidationError(
      {
        serviceId: "task-manager",
        state: "running",
        observedAt: invalidObservedAt,
      },
      "invalid_observation_timestamp",
    );
  });

  it("rejects an invalid stable service identifier", () => {
    expectValidationError(
      {
        serviceId: "Task Manager",
        state: "running",
        observedAt,
      },
      "invalid_service_status",
    );
  });

  it("does not expose rejected values in validation errors", () => {
    const rejectedState = "credential-secret";

    try {
      RegisteredServiceStatus.create({
        serviceId: "task-manager",
        state: rejectedState,
        observedAt,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RegisteredServiceStatusValidationError);
      expect(String(error)).not.toContain(rejectedState);
    }
  });
});
