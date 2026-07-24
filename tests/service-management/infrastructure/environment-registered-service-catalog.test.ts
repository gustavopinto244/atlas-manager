import { describe, expect, it } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  createRegisteredServiceCatalogFromEnvironment,
  RegisteredServiceConfigurationError,
  type RegisteredServiceConfigurationErrorCode,
} from "../../../src/service-management/infrastructure/environment-registered-service-catalog.js";

interface ConfiguredService {
  readonly id: unknown;
  readonly displayName: unknown;
  readonly managementAdapter: unknown;
  readonly externalResourceId: unknown;
  readonly supportedOperations: unknown;
}

function createConfiguredService(
  index = 0,
  overrides: Partial<ConfiguredService> = {},
): ConfiguredService {
  return {
    id: `service-${index}`,
    displayName: `Service ${index}`,
    managementAdapter: "mock",
    externalResourceId: `external-resource-${index}`,
    supportedOperations: ["readStatus"],
    ...overrides,
  };
}

function createEnvironment(
  configuredValue: unknown,
): Readonly<Record<string, string | undefined>> {
  return {
    REGISTERED_SERVICES_JSON:
      typeof configuredValue === "string"
        ? configuredValue
        : JSON.stringify(configuredValue),
  };
}

function expectConfigurationError(
  configuredValue: unknown,
  code: RegisteredServiceConfigurationErrorCode,
): void {
  expect(() =>
    createRegisteredServiceCatalogFromEnvironment(
      createEnvironment(configuredValue),
    ),
  ).toThrowError(
    expect.objectContaining({
      name: "RegisteredServiceConfigurationError",
      code,
    }),
  );
}

describe("createRegisteredServiceCatalogFromEnvironment", () => {
  it.each([
    ["an absent variable", {}],
    [
      "an explicitly undefined variable",
      { REGISTERED_SERVICES_JSON: undefined },
    ],
    ["an explicit empty array", { REGISTERED_SERVICES_JSON: "[]" }],
  ] as const)(
    "creates an immutable empty catalog for %s",
    async (_label, env) => {
      const catalog = createRegisteredServiceCatalogFromEnvironment(env);
      const services = await catalog.list();

      expect(services).toEqual([]);
      await expect(catalog.findById("unknown-service")).resolves.toBeNull();
      expect(Object.isFrozen(catalog)).toBe(true);
      expect(Object.isFrozen(services)).toBe(true);
    },
  );

  it("reads only REGISTERED_SERVICES_JSON and does not mutate input", async () => {
    const environment = {
      REGISTERED_SERVICES_JSON: JSON.stringify([createConfiguredService()]),
      HOST: "private-host-value",
      PORT: "private-port-value",
      LOG_LEVEL: "private-log-level",
    };
    const originalEnvironment = { ...environment };
    const catalog = createRegisteredServiceCatalogFromEnvironment(environment);

    expect(environment).toEqual(originalEnvironment);
    await expect(catalog.findById("service-0")).resolves.toBeInstanceOf(
      RegisteredService,
    );
  });

  it.each(["", " ", "\n\t"])(
    "rejects empty or whitespace-only input",
    (configuredValue) => {
      expectConfigurationError(
        configuredValue,
        "registered_services_invalid_json",
      );
    },
  );

  it("accepts a structurally valid input exactly at the byte limit", async () => {
    const configuredValue = "[]" + " ".repeat(65_536 - 2);

    expect(Buffer.byteLength(configuredValue, "utf8")).toBe(65_536);

    const catalog = createRegisteredServiceCatalogFromEnvironment({
      REGISTERED_SERVICES_JSON: configuredValue,
    });

    await expect(catalog.list()).resolves.toEqual([]);
  });

  it("rejects input exceeding the byte limit before parsing", () => {
    const oversizedMalformedInput = "x".repeat(65_537);

    expectConfigurationError(
      oversizedMalformedInput,
      "registered_services_too_large",
    );
  });

  it("measures the input limit in UTF-8 bytes", () => {
    const multibyteInput = JSON.stringify("é".repeat(32_768));

    expect(multibyteInput.length).toBeLessThan(65_536);
    expect(Buffer.byteLength(multibyteInput, "utf8")).toBeGreaterThan(65_536);
    expectConfigurationError(multibyteInput, "registered_services_too_large");
  });

  it("accepts exactly 100 configured services", async () => {
    const configuredServices = Array.from({ length: 100 }, (_, index) =>
      createConfiguredService(index),
    );
    const catalog = createRegisteredServiceCatalogFromEnvironment(
      createEnvironment(configuredServices),
    );

    await expect(catalog.list()).resolves.toHaveLength(100);
  });

  it("rejects more than 100 configured services", () => {
    const configuredServices = Array.from({ length: 101 }, (_, index) =>
      createConfiguredService(index),
    );

    expectConfigurationError(
      configuredServices,
      "registered_services_limit_exceeded",
    );
  });

  it("creates valid mock and PM2 services in configuration order", async () => {
    const configuredServices = [
      createConfiguredService(1, {
        displayName: "  First Service  ",
        externalResourceId: "  first-resource  ",
      }),
      createConfiguredService(2, {
        managementAdapter: "pm2",
        supportedOperations: ["readStatus", "start", "stop", "restart"],
      }),
      createConfiguredService(3),
    ];
    const catalog = createRegisteredServiceCatalogFromEnvironment(
      createEnvironment(configuredServices),
    );

    const services = await catalog.list();

    expect(services.map((service) => service.id)).toEqual([
      "service-1",
      "service-2",
      "service-3",
    ]);
    expect(services[0]).toEqual({
      id: "service-1",
      displayName: "First Service",
      managementAdapter: "mock",
      externalResourceId: "first-resource",
      supportedOperations: ["readStatus"],
    });
    expect(services[1]?.managementAdapter).toBe("pm2");
    expect(
      services.every((service) => service instanceof RegisteredService),
    ).toBe(true);
    expect(services.every((service) => Object.isFrozen(service))).toBe(true);
    expect(
      services.every((service) => Object.isFrozen(service.supportedOperations)),
    ).toBe(true);
  });

  it.each([
    ["null", "null"],
    ["an object", JSON.stringify({})],
    ["a string", JSON.stringify("services")],
    ["a number", "42"],
    ["a boolean", "true"],
  ])("rejects %s as a non-array shape", (_description, configuredValue) => {
    expectConfigurationError(
      configuredValue,
      "registered_services_invalid_shape",
    );
  });

  it("rejects malformed JSON distinctly from invalid shape", () => {
    expectConfigurationError("[not-json]", "registered_services_invalid_json");
  });

  it.each([
    ["a null entry", null],
    ["a string entry", "service"],
    ["an array entry", []],
    ["a numeric entry", 42],
  ])("rejects %s", (_description, entry) => {
    expectConfigurationError([entry], "registered_services_invalid_shape");
  });

  it.each([
    "id",
    "displayName",
    "managementAdapter",
    "externalResourceId",
    "supportedOperations",
  ] as const)("rejects an entry missing %s", (missingField) => {
    const entry = { ...createConfiguredService() };

    delete entry[missingField];

    expectConfigurationError([entry], "registered_services_invalid_shape");
  });

  it("rejects unknown fields", () => {
    expectConfigurationError(
      [{ ...createConfiguredService(), command: "private-command" }],
      "registered_services_invalid_shape",
    );
  });

  it("does not accept inherited fields as required fields", () => {
    const inheritedEntry = Object.create({
      id: "inherited-service",
    }) as Record<string, unknown>;

    Object.assign(inheritedEntry, {
      displayName: "Inherited Service",
      managementAdapter: "mock",
      externalResourceId: "inherited-resource",
      supportedOperations: ["readStatus"],
    });

    expectConfigurationError(
      [inheritedEntry],
      "registered_services_invalid_shape",
    );
  });

  it.each([
    ["id", 42],
    ["displayName", null],
    ["managementAdapter", true],
    ["externalResourceId", {}],
    ["supportedOperations", "readStatus"],
    ["supportedOperations", ["readStatus", 42]],
  ])("rejects an invalid structural value for %s", (field, value) => {
    expectConfigurationError(
      [{ ...createConfiguredService(), [field]: value }],
      "registered_services_invalid_shape",
    );
  });

  it.each([
    ["an invalid service ID", { id: "Invalid Service" }],
    ["an invalid display name", { displayName: " " }],
    ["an invalid adapter", { managementAdapter: "docker" }],
    ["an invalid external resource", { externalResourceId: " " }],
    ["an invalid operation", { supportedOperations: ["readStatus", "reload"] }],
    [
      "duplicate operations",
      { supportedOperations: ["readStatus", "readStatus"] },
    ],
    ["missing readStatus", { supportedOperations: ["start"] }],
  ])("translates %s from domain validation", (_description, overrides) => {
    expectConfigurationError(
      [createConfiguredService(0, overrides)],
      "registered_service_invalid",
    );
  });

  it("rejects the complete configuration when a later service is invalid", () => {
    const configuredServices = [
      createConfiguredService(1),
      createConfiguredService(2),
      createConfiguredService(3, { managementAdapter: "unapproved" }),
    ];

    expectConfigurationError(configuredServices, "registered_service_invalid");
  });

  it("translates duplicate stable IDs as a catalog failure", () => {
    expectConfigurationError(
      [
        createConfiguredService(1),
        createConfiguredService(2, { id: "service-1" }),
      ],
      "registered_service_catalog_invalid",
    );
  });

  it.each(["mock", "pm2"])(
    "translates duplicate %s external resources as a catalog failure",
    (managementAdapter) => {
      expectConfigurationError(
        [
          createConfiguredService(1, {
            managementAdapter,
            externalResourceId: "shared-resource",
          }),
          createConfiguredService(2, {
            managementAdapter,
            externalResourceId: "shared-resource",
          }),
        ],
        "registered_service_catalog_invalid",
      );
    },
  );

  it("preserves cross-adapter external-resource behavior", async () => {
    const catalog = createRegisteredServiceCatalogFromEnvironment(
      createEnvironment([
        createConfiguredService(1, {
          managementAdapter: "mock",
          externalResourceId: "shared-resource",
        }),
        createConfiguredService(2, {
          managementAdapter: "pm2",
          externalResourceId: "shared-resource",
        }),
      ]),
    );

    await expect(catalog.list()).resolves.toHaveLength(2);
  });

  it.each([
    [
      "invalid JSON",
      "private-service-id private-process-name readStatus credential-value",
      "registered_services_invalid_json",
    ],
    [
      "invalid domain data",
      JSON.stringify([
        createConfiguredService(0, {
          id: "private service id",
          displayName: "Private Display Name",
          externalResourceId: "private-process-name",
          supportedOperations: ["readStatus", "credential-operation"],
        }),
      ]),
      "registered_service_invalid",
    ],
    [
      "invalid catalog data",
      JSON.stringify([
        createConfiguredService(1, {
          id: "private-service-id",
          externalResourceId: "private-process-name",
        }),
        createConfiguredService(2, {
          id: "private-service-id",
          externalResourceId: "another-private-process",
        }),
      ]),
      "registered_service_catalog_invalid",
    ],
  ] as const)(
    "does not expose configured values for %s",
    (_description, configuredValue, expectedCode) => {
      try {
        createRegisteredServiceCatalogFromEnvironment({
          REGISTERED_SERVICES_JSON: configuredValue,
        });
        expect.unreachable("Expected configuration failure");
      } catch (error) {
        expect(error).toBeInstanceOf(RegisteredServiceConfigurationError);
        expect(error).toEqual(expect.objectContaining({ code: expectedCode }));

        const exposedError = `${String(error)} ${JSON.stringify(error)}`;

        for (const sensitiveValue of [
          configuredValue,
          "private-service-id",
          "Private Display Name",
          "private-process-name",
          "credential-operation",
          "credential-value",
        ]) {
          expect(exposedError).not.toContain(sensitiveValue);
        }
        expect(error).not.toHaveProperty("cause");
        expect(error).not.toHaveProperty("environment");
      }
    },
  );
});
