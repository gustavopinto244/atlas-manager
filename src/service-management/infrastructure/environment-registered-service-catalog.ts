import {
  RegisteredService,
  RegisteredServiceValidationError,
  type CreateRegisteredServiceInput,
} from "../domain/registered-service.js";
import {
  InMemoryRegisteredServiceCatalog,
  RegisteredServiceCatalogError,
} from "./in-memory-registered-service-catalog.js";

const REGISTERED_SERVICES_VARIABLE = "REGISTERED_SERVICES_JSON";
const MAX_REGISTERED_SERVICES_JSON_BYTES = 65_536;
const MAX_REGISTERED_SERVICES = 100;
const requiredEntryFields = Object.freeze([
  "id",
  "displayName",
  "managementAdapter",
  "externalResourceId",
  "supportedOperations",
  "availabilityPolicy",
] as const);
const allowedEntryFields = Object.freeze([
  ...requiredEntryFields,
  "managementConfiguration",
]);

export type RegisteredServiceConfigurationErrorCode =
  | "registered_services_too_large"
  | "registered_services_invalid_json"
  | "registered_services_invalid_shape"
  | "registered_services_limit_exceeded"
  | "registered_service_invalid"
  | "registered_service_catalog_invalid";

export class RegisteredServiceConfigurationError extends Error {
  public override readonly name = "RegisteredServiceConfigurationError";

  public constructor(
    public readonly code: RegisteredServiceConfigurationErrorCode,
  ) {
    super(`Invalid registered-service configuration: ${code}`);
  }
}

export function createRegisteredServiceCatalogFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): InMemoryRegisteredServiceCatalog {
  const configuredValue = environment[REGISTERED_SERVICES_VARIABLE];

  if (configuredValue === undefined) {
    return InMemoryRegisteredServiceCatalog.create([]);
  }

  if (
    Buffer.byteLength(configuredValue, "utf8") >
    MAX_REGISTERED_SERVICES_JSON_BYTES
  ) {
    throw new RegisteredServiceConfigurationError(
      "registered_services_too_large",
    );
  }

  const entries = parseEntries(configuredValue);

  if (entries.length > MAX_REGISTERED_SERVICES) {
    throw new RegisteredServiceConfigurationError(
      "registered_services_limit_exceeded",
    );
  }

  const services = entries.map((entry) => {
    const input = parseEntryShape(entry);

    try {
      return RegisteredService.create(input);
    } catch (error) {
      if (error instanceof RegisteredServiceValidationError) {
        throw new RegisteredServiceConfigurationError(
          "registered_service_invalid",
        );
      }

      throw error;
    }
  });

  try {
    return InMemoryRegisteredServiceCatalog.create(services);
  } catch (error) {
    if (error instanceof RegisteredServiceCatalogError) {
      throw new RegisteredServiceConfigurationError(
        "registered_service_catalog_invalid",
      );
    }

    throw error;
  }
}

function parseEntries(configuredValue: string): readonly unknown[] {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(configuredValue);
  } catch {
    throw new RegisteredServiceConfigurationError(
      "registered_services_invalid_json",
    );
  }

  if (!Array.isArray(parsedValue)) {
    throw new RegisteredServiceConfigurationError(
      "registered_services_invalid_shape",
    );
  }

  return parsedValue;
}

function parseEntryShape(entry: unknown): CreateRegisteredServiceInput {
  if (!isPlainObject(entry) || !hasExactlyRequiredFields(entry)) {
    throw new RegisteredServiceConfigurationError(
      "registered_services_invalid_shape",
    );
  }

  const id = entry["id"];
  const displayName = entry["displayName"];
  const managementAdapter = entry["managementAdapter"];
  const externalResourceId = entry["externalResourceId"];
  const supportedOperations = entry["supportedOperations"];
  const availabilityPolicy = entry["availabilityPolicy"];
  const managementConfiguration = entry["managementConfiguration"];

  if (
    typeof id !== "string" ||
    typeof displayName !== "string" ||
    typeof managementAdapter !== "string" ||
    typeof externalResourceId !== "string" ||
    !Array.isArray(supportedOperations) ||
    !supportedOperations.every(
      (operation): operation is string => typeof operation === "string",
    )
  ) {
    throw new RegisteredServiceConfigurationError(
      "registered_services_invalid_shape",
    );
  }

  return {
    id,
    displayName,
    managementAdapter,
    externalResourceId,
    supportedOperations,
    availabilityPolicy,
    ...(Object.hasOwn(entry, "managementConfiguration")
      ? {
          managementConfiguration: managementConfiguration as Record<
            string,
            unknown
          >,
        }
      : {}),
  };
}

const allowedEntryFieldSet = new Set<string>(allowedEntryFields);

function hasExactlyRequiredFields(
  entry: Record<PropertyKey, unknown>,
): boolean {
  const fields = Reflect.ownKeys(entry);

  return (
    requiredEntryFields.every((field) => Object.hasOwn(entry, field)) &&
    fields.every(
      (field) => typeof field === "string" && allowedEntryFieldSet.has(field),
    )
  );
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}
