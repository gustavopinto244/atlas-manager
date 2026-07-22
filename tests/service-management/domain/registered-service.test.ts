import { describe, expect, it } from "vitest";

import {
  RegisteredService,
  RegisteredServiceValidationError,
  SERVICE_MANAGEMENT_ADAPTERS,
  SUPPORTED_SERVICE_OPERATIONS,
  type CreateRegisteredServiceInput,
} from "../../../src/service-management/domain/registered-service.js";

function createValidInput(
  overrides: Partial<CreateRegisteredServiceInput> = {},
): CreateRegisteredServiceInput {
  return {
    id: "task-manager",
    displayName: "Task Manager",
    managementAdapter: "pm2",
    externalResourceId: "task-manager-api",
    supportedOperations: ["readStatus", "start", "stop", "restart"],
    ...overrides,
  };
}

function expectValidationError(
  input: CreateRegisteredServiceInput,
  code: RegisteredServiceValidationError["code"],
): void {
  expect(() => RegisteredService.create(input)).toThrowError(
    expect.objectContaining({
      name: "RegisteredServiceValidationError",
      code,
    }),
  );
}

describe("RegisteredService", () => {
  it("creates a valid PM2 registered service", () => {
    const service = RegisteredService.create(createValidInput());

    expect(service).toEqual({
      id: "task-manager",
      displayName: "Task Manager",
      managementAdapter: "pm2",
      externalResourceId: "task-manager-api",
      supportedOperations: ["readStatus", "start", "stop", "restart"],
    });
  });

  it("creates a valid mock read-only service", () => {
    const service = RegisteredService.create(
      createValidInput({
        id: "legacy-monitor",
        displayName: "Legacy Monitor",
        managementAdapter: "mock",
        externalResourceId: "legacy-monitor",
        supportedOperations: ["readStatus"],
      }),
    );

    expect(service.managementAdapter).toBe("mock");
    expect(service.supportedOperations).toEqual(["readStatus"]);
  });

  it("defines exactly the initial adapters and supported operations", () => {
    expect(SERVICE_MANAGEMENT_ADAPTERS).toEqual(["mock", "pm2"]);
    expect(SUPPORTED_SERVICE_OPERATIONS).toEqual([
      "readStatus",
      "start",
      "stop",
      "restart",
    ]);

    const service = RegisteredService.create(createValidInput());

    expect(service.supportedOperations).toEqual(SUPPORTED_SERVICE_OPERATIONS);
  });

  it.each(["a", "a".repeat(64)])(
    "accepts a valid identifier boundary: %s",
    (id) => {
      expect(RegisteredService.create(createValidInput({ id })).id).toBe(id);
    },
  );

  it.each([
    ["an empty identifier", ""],
    ["an identifier longer than 64 characters", "a".repeat(65)],
    ["uppercase characters", "Task-manager"],
    ["whitespace", "task manager"],
    ["a leading hyphen", "-task-manager"],
    ["a trailing hyphen", "task-manager-"],
    ["consecutive hyphens", "task--manager"],
    ["punctuation", "pm2:task-manager"],
  ])("rejects %s in the service identifier", (_description, id) => {
    expectValidationError(createValidInput({ id }), "invalid_id");
  });

  it("trims and preserves an approved display name", () => {
    const service = RegisteredService.create(
      createValidInput({ displayName: "  Atlas Manager API  " }),
    );

    expect(service.displayName).toBe("Atlas Manager API");
  });

  it.each([
    ["an empty display name", ""],
    ["a whitespace-only display name", "   "],
    ["a display name longer than 100 characters", "a".repeat(101)],
    ["a display name containing a control character", "Task\nManager"],
  ])("rejects %s", (_description, displayName) => {
    expectValidationError(
      createValidInput({ displayName }),
      "invalid_display_name",
    );
  });

  it("trims and preserves an external resource identifier independently", () => {
    const service = RegisteredService.create(
      createValidInput({
        id: "task-manager",
        externalResourceId: "  PM2 Task Manager API:production  ",
      }),
    );

    expect(service.id).toBe("task-manager");
    expect(service.externalResourceId).toBe("PM2 Task Manager API:production");
  });

  it.each([
    ["an empty external resource identifier", ""],
    ["a whitespace-only external resource identifier", "   "],
    [
      "an external resource identifier longer than 128 characters",
      "a".repeat(129),
    ],
    [
      "an external resource identifier containing a control character",
      "process\u0000name",
    ],
  ])("rejects %s", (_description, externalResourceId) => {
    expectValidationError(
      createValidInput({ externalResourceId }),
      "invalid_external_resource_id",
    );
  });

  it("rejects an unsupported management adapter", () => {
    expectValidationError(
      createValidInput({ managementAdapter: "docker" }),
      "invalid_management_adapter",
    );
  });

  it("rejects an empty supported-operation collection", () => {
    expectValidationError(
      createValidInput({ supportedOperations: [] }),
      "invalid_supported_operations",
    );
  });

  it("rejects a collection without readStatus", () => {
    expectValidationError(
      createValidInput({ supportedOperations: ["start", "stop"] }),
      "invalid_supported_operations",
    );
  });

  it("rejects duplicate supported operations", () => {
    expectValidationError(
      createValidInput({ supportedOperations: ["readStatus", "readStatus"] }),
      "invalid_supported_operations",
    );
  });

  it("rejects an unsupported operation without interpreting it as a command", () => {
    expectValidationError(
      createValidInput({ supportedOperations: ["readStatus", "rm -rf"] }),
      "invalid_supported_operations",
    );
  });

  it("does not retain or expose a mutable caller-owned operations array", () => {
    const callerOperations = ["readStatus", "start"];
    const service = RegisteredService.create(
      createValidInput({ supportedOperations: callerOperations }),
    );

    callerOperations.push("stop");

    expect(service.supportedOperations).toEqual(["readStatus", "start"]);
    expect(Object.isFrozen(service.supportedOperations)).toBe(true);
  });

  it("does not include rejected values in validation errors", () => {
    const unsafeValue = "credential-secret\ncommand --dangerous";

    expect(() =>
      RegisteredService.create(createValidInput({ displayName: unsafeValue })),
    ).toThrowError(RegisteredServiceValidationError);

    try {
      RegisteredService.create(createValidInput({ displayName: unsafeValue }));
    } catch (error) {
      expect(String(error)).not.toContain("credential-secret");
      expect(String(error)).not.toContain("command --dangerous");
    }
  });
});
