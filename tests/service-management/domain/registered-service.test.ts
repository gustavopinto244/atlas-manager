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
    availabilityPolicy: { mode: "manual" },
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
      availabilityPolicy: {
        mode: "manual",
        timezone: null,
        schedule: null,
      },
      managementConfiguration: null,
      dependencies: Object.freeze([]),
      readinessPolicy: Object.freeze({
        mode: "runtime",
        timeoutMilliseconds: 30000,
        pollIntervalMilliseconds: 500,
      }),
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

  it("accepts empty dependencies and keeps the canonical collection immutable", () => {
    const service = RegisteredService.create(
      createValidInput({ dependencies: [] }),
    );

    expect(service.dependencies).toEqual([]);
    expect(Object.isFrozen(service.dependencies)).toBe(true);
  });

  it("preserves one and multiple canonical dependencies without caller ownership", () => {
    const dependencies = ["atlas-postgres", "atlas-redis"];
    const service = RegisteredService.create(
      createValidInput({ dependencies }),
    );

    dependencies.reverse();

    expect(service.dependencies).toEqual(["atlas-postgres", "atlas-redis"]);
    expect(service.dependencies).not.toBe(dependencies);
    expect(Object.isFrozen(service.dependencies)).toBe(true);
  });

  it("accepts the direct-dependency limit and rejects one more dependency", () => {
    const dependencies = Array.from(
      { length: 16 },
      (_, index) => `dependency-${index}`,
    );

    const service = RegisteredService.create(
      createValidInput({ dependencies }),
    );

    expect(service.dependencies).toHaveLength(16);
    expect(Object.isFrozen(service.dependencies)).toBe(true);
    expectValidationError(
      createValidInput({ dependencies: [...dependencies, "dependency-16"] }),
      "invalid_dependencies",
    );
  });

  it.each([
    ["null", null],
    ["a string", "atlas-postgres"],
    ["a number", 42],
    ["a boolean", true],
    ["a plain object", {}],
    ["a function", () => "atlas-postgres"],
    ["an array containing a number", [42]],
    ["an array containing null", [null]],
    ["an array containing an object", [{}]],
  ])(
    "rejects %s as an invalid dependency collection",
    (_label, dependencies) => {
      expectValidationError(
        createValidInput({ dependencies }),
        "invalid_dependencies",
      );
    },
  );

  it.each([
    ["an empty identifier", ""],
    ["surrounding whitespace", " atlas-postgres"],
    ["uppercase characters", "Atlas-postgres"],
    ["embedded whitespace", "atlas postgres"],
    ["a leading hyphen", "-atlas-postgres"],
    ["a trailing hyphen", "atlas-postgres-"],
    ["consecutive hyphens", "atlas--postgres"],
    ["unsupported punctuation", "atlas_postgres"],
    ["an identifier longer than 64 characters", "a".repeat(65)],
    ["control-character content", "atlas-\u0000postgres"],
  ])("rejects %s in a dependency identifier", (_label, dependency) => {
    expectValidationError(
      createValidInput({ dependencies: [dependency] }),
      "invalid_dependencies",
    );
  });

  it("accepts dependency identifiers at lengths one and 64", () => {
    const service = RegisteredService.create(
      createValidInput({ dependencies: ["a", "b".repeat(64)] }),
    );

    expect(service.dependencies).toEqual(["a", "b".repeat(64)]);
  });

  it("rejects self-dependency and duplicate direct dependencies", () => {
    expectValidationError(
      createValidInput({ id: "atlas-api", dependencies: ["atlas-api"] }),
      "invalid_dependencies",
    );
    expectValidationError(
      createValidInput({
        dependencies: ["atlas-postgres", "atlas-postgres"],
      }),
      "invalid_dependencies",
    );
  });

  it.each(["mock", "pm2"] as const)(
    "rejects health readiness for %s",
    (managementAdapter) => {
      expectValidationError(
        createValidInput({
          managementAdapter,
          readinessPolicy: { mode: "health" },
        }),
        "invalid_readiness_policy",
      );
    },
  );

  it("accepts health readiness for Docker and Compose services", () => {
    expect(
      RegisteredService.create(
        createValidInput({
          managementAdapter: "docker",
          readinessPolicy: { mode: "health" },
        }),
      ).readinessPolicy.mode,
    ).toBe("health");

    expect(
      RegisteredService.create(
        createValidInput({
          managementAdapter: "docker-compose",
          readinessPolicy: { mode: "health" },
          managementConfiguration: {
            composeFile: "/srv/atlas/compose.yaml",
            projectDirectory: "/srv/atlas",
          },
        }),
      ).readinessPolicy.mode,
    ).toBe("health");
  });

  it.each(["always", "manual", "disabled"] as const)(
    "associates a canonical frozen %s availability policy",
    (mode) => {
      const service = RegisteredService.create(
        createValidInput({ availabilityPolicy: { mode } }),
      );

      expect(service.availabilityPolicy).toEqual({
        mode,
        timezone: null,
        schedule: null,
      });
      expect(Object.isFrozen(service)).toBe(true);
      expect(Object.isFrozen(service.availabilityPolicy)).toBe(true);
    },
  );

  it("associates a deeply immutable canonical scheduled policy", () => {
    const sourceWindow = {
      weekday: "friday",
      start: "13:00",
      end: "17:00",
    };
    const windows = [
      sourceWindow,
      { weekday: "monday", start: "09:00", end: "12:00" },
    ];
    const availabilityPolicy = {
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows,
    };
    const input = createValidInput({ availabilityPolicy });
    const service = RegisteredService.create(input);

    expect(service.availabilityPolicy).toEqual({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      schedule: {
        windows: [
          { weekday: "monday", start: "09:00", end: "12:00" },
          { weekday: "friday", start: "13:00", end: "17:00" },
        ],
      },
    });
    expect(Object.isFrozen(service.availabilityPolicy)).toBe(true);

    if (service.availabilityPolicy.schedule === null) {
      throw new Error("Expected a scheduled policy");
    }

    expect(Object.isFrozen(service.availabilityPolicy.schedule)).toBe(true);
    expect(Object.isFrozen(service.availabilityPolicy.schedule.windows)).toBe(
      true,
    );
    expect(
      service.availabilityPolicy.schedule.windows.every(Object.isFrozen),
    ).toBe(true);

    Reflect.set(input, "availabilityPolicy", { mode: "disabled" });
    availabilityPolicy.timezone = "UTC";
    windows.reverse();
    sourceWindow.start = "14:00";

    expect(service.availabilityPolicy).toEqual({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      schedule: {
        windows: [
          { weekday: "monday", start: "09:00", end: "12:00" },
          { weekday: "friday", start: "13:00", end: "17:00" },
        ],
      },
    });
  });

  it.each([
    undefined,
    null,
    "manual",
    {},
    { mode: "automatic" },
    { mode: "manual", timezone: null },
    { mode: "scheduled" },
    {
      mode: "scheduled",
      timezone: "UTC",
      windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
    },
    {
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: [],
    },
    {
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: [{ weekday: "holiday", start: "09:00", end: "17:00" }],
    },
    {
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: [{ weekday: "monday", start: "9:00", end: "17:00" }],
    },
    {
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: [
        { weekday: "monday", start: "09:00", end: "12:00" },
        { weekday: "monday", start: "11:00", end: "17:00" },
      ],
    },
    {
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: Array.from({ length: 65 }, () => ({
        weekday: "monday",
        start: "09:00",
        end: "17:00",
      })),
    },
  ])("rejects invalid availability policy %#", (availabilityPolicy) => {
    expectValidationError(
      createValidInput({ availabilityPolicy }),
      "invalid_availability_policy",
    );
  });

  it("does not translate unexpected policy factory failures", () => {
    const unexpectedError = new Error("unexpected-programming-failure");
    const availabilityPolicy = {
      get mode(): never {
        throw unexpectedError;
      },
    };

    expect(() =>
      RegisteredService.create(createValidInput({ availabilityPolicy })),
    ).toThrow(unexpectedError);
  });

  it("defines exactly the initial adapters and supported operations", () => {
    expect(SERVICE_MANAGEMENT_ADAPTERS).toEqual([
      "mock",
      "pm2",
      "docker",
      "docker-compose",
    ]);
    expect(SUPPORTED_SERVICE_OPERATIONS).toEqual([
      "readStatus",
      "readLogs",
      "start",
      "stop",
      "restart",
    ]);

    const service = RegisteredService.create(
      createValidInput({
        supportedOperations: [
          "readStatus",
          "readLogs",
          "start",
          "stop",
          "restart",
        ],
      }),
    );

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
      createValidInput({ managementAdapter: "kubernetes" }),
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
