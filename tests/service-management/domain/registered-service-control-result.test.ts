import { describe, expect, it } from "vitest";

import type { SupportedServiceOperation } from "../../../src/service-management/domain/registered-service.js";
import {
  RegisteredServiceControlResult,
  RegisteredServiceControlResultValidationError,
  SERVICE_CONTROL_OPERATIONS,
  type RegisteredServiceControlResultValidationErrorCode,
} from "../../../src/service-management/domain/registered-service-control-result.js";

const completedAt = "2026-07-24T12:00:00.000Z";

function expectValidationError(
  input: Parameters<typeof RegisteredServiceControlResult.create>[0],
  code: RegisteredServiceControlResultValidationErrorCode,
): void {
  expect(() => RegisteredServiceControlResult.create(input)).toThrowError(
    expect.objectContaining({
      name: "RegisteredServiceControlResultValidationError",
      code,
    }),
  );
}

describe("RegisteredServiceControlResult", () => {
  it.each(SERVICE_CONTROL_OPERATIONS)(
    "creates an immutable %s result with only approved fields",
    (operation) => {
      const result = RegisteredServiceControlResult.create({
        serviceId: "task-manager",
        operation,
        completedAt,
      });

      expect(result).toEqual({
        serviceId: "task-manager",
        operation,
        completedAt,
      });
      expect(Object.keys(result)).toEqual([
        "serviceId",
        "operation",
        "completedAt",
      ]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(result).not.toHaveProperty("externalResourceId");
      expect(result).not.toHaveProperty("managementAdapter");
      expect(result).not.toHaveProperty("supportedOperations");
      expect(result).not.toHaveProperty("state");
    },
  );

  it("defines exactly the registered-service control operations", () => {
    const registeredServiceOperations: readonly SupportedServiceOperation[] =
      SERVICE_CONTROL_OPERATIONS;

    expect(registeredServiceOperations).toEqual(["start", "stop", "restart"]);
    expect(Object.isFrozen(SERVICE_CONTROL_OPERATIONS)).toBe(true);
    expect(SERVICE_CONTROL_OPERATIONS).not.toContain("readStatus");
  });

  it("cannot be mutated through the public runtime allowlist", () => {
    expect(() =>
      (SERVICE_CONTROL_OPERATIONS as unknown as string[]).push("reload"),
    ).toThrow(TypeError);
    expect(SERVICE_CONTROL_OPERATIONS).toEqual(["start", "stop", "restart"]);
  });

  it.each(["readStatus", "reload", "pm2 restart"])(
    "rejects the non-control operation %s",
    (operation) => {
      expectValidationError(
        {
          serviceId: "task-manager",
          operation,
          completedAt,
        },
        "invalid_control_operation",
      );
    },
  );

  it.each([
    ["an invalid timestamp", "not-a-date"],
    ["a non-UTC timestamp", "2026-07-24T09:00:00.000-03:00"],
    ["a non-canonical timestamp", "2026-07-24T12:00:00Z"],
  ])("rejects %s", (_description, invalidCompletedAt) => {
    expectValidationError(
      {
        serviceId: "task-manager",
        operation: "start",
        completedAt: invalidCompletedAt,
      },
      "invalid_completion_timestamp",
    );
  });

  it("rejects an invalid stable service identifier", () => {
    expectValidationError(
      {
        serviceId: "Task Manager",
        operation: "start",
        completedAt,
      },
      "invalid_service_id",
    );
  });

  it("does not expose rejected values in validation errors", () => {
    const rejectedOperation = "credential-secret-command";

    try {
      RegisteredServiceControlResult.create({
        serviceId: "task-manager",
        operation: rejectedOperation,
        completedAt,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(
        RegisteredServiceControlResultValidationError,
      );
      expect(String(error)).not.toContain(rejectedOperation);
    }
  });
});
