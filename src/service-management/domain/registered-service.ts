import { ServiceAvailabilityModeValidationError } from "../../service-scheduling/domain/service-availability-mode.js";
import {
  createServiceAvailabilityPolicy,
  type ServiceAvailabilityPolicy,
} from "../../service-scheduling/domain/service-availability-policy.js";
import { ServiceAvailabilityPolicyValidationError } from "../../service-scheduling/domain/service-availability-policy-validation-error.js";
import { ServiceScheduleTimezoneValidationError } from "../../service-scheduling/domain/service-schedule-timezone.js";
import { ServiceScheduleValidationError } from "../../service-scheduling/domain/service-schedule-validation-error.js";
import {
  validateDockerComposeManagementConfiguration,
  type ManagementConfiguration,
  type DockerComposeManagementConfiguration,
  ManagementConfigurationValidationError,
} from "./management-configuration.js";
import {
  createReadinessPolicy,
  defaultReadinessPolicy,
  type ReadinessPolicy,
  ReadinessPolicyValidationError,
} from "./readiness-policy.js";

export const SERVICE_MANAGEMENT_ADAPTERS = Object.freeze([
  "mock",
  "pm2",
  "docker",
  "docker-compose",
] as const);

export type ServiceManagementAdapter =
  (typeof SERVICE_MANAGEMENT_ADAPTERS)[number];

export const SUPPORTED_SERVICE_OPERATIONS = Object.freeze([
  "readStatus",
  "readLogs",
  "start",
  "stop",
  "restart",
] as const);

export type SupportedServiceOperation =
  (typeof SUPPORTED_SERVICE_OPERATIONS)[number];

export type RegisteredServiceValidationErrorCode =
  | "invalid_id"
  | "invalid_display_name"
  | "invalid_management_adapter"
  | "invalid_external_resource_id"
  | "invalid_supported_operations"
  | "invalid_availability_policy"
  | "invalid_management_configuration"
  | "invalid_dependencies"
  | "invalid_readiness_policy";

export class RegisteredServiceValidationError extends Error {
  public override readonly name = "RegisteredServiceValidationError";

  public constructor(
    public readonly code: RegisteredServiceValidationErrorCode,
  ) {
    super(`Invalid registered service: ${code}`);
  }
}

export interface CreateRegisteredServiceInput {
  readonly id: string;
  readonly displayName: string;
  readonly managementAdapter: string;
  readonly externalResourceId: string;
  readonly supportedOperations: readonly string[];
  readonly availabilityPolicy: unknown;
  readonly managementConfiguration?: ManagementConfiguration;
  readonly dependencies?: unknown;
  readonly readinessPolicy?: unknown;
}

export class RegisteredService {
  private constructor(
    public readonly id: string,
    public readonly displayName: string,
    public readonly managementAdapter: ServiceManagementAdapter,
    public readonly externalResourceId: string,
    public readonly supportedOperations: readonly SupportedServiceOperation[],
    public readonly availabilityPolicy: ServiceAvailabilityPolicy,
    public readonly managementConfiguration: DockerComposeManagementConfiguration | null,
    public readonly dependencies: readonly string[],
    public readonly readinessPolicy: ReadinessPolicy,
  ) {
    Object.freeze(this);
  }

  public static create(input: CreateRegisteredServiceInput): RegisteredService {
    const id = validateServiceId(input.id);
    const displayName = validateDisplayName(input.displayName);
    const managementAdapter = validateManagementAdapter(
      input.managementAdapter,
    );
    const externalResourceId = validateExternalResourceId(
      input.externalResourceId,
    );
    const supportedOperations = validateSupportedOperations(
      input.supportedOperations,
    );
    const availabilityPolicy = validateAvailabilityPolicy(
      input.availabilityPolicy,
    );
    const managementConfiguration = validateAndGetManagementConfiguration(
      managementAdapter,
      input.managementConfiguration,
    );
    const dependencies = validateDependencies(input.dependencies, id);
    const readinessPolicy = validateReadinessPolicy(input.readinessPolicy);
    if (
      readinessPolicy.mode === "health" &&
      managementAdapter !== "docker" &&
      managementAdapter !== "docker-compose"
    ) {
      throw new RegisteredServiceValidationError("invalid_readiness_policy");
    }

    return new RegisteredService(
      id,
      displayName,
      managementAdapter,
      externalResourceId,
      supportedOperations,
      availabilityPolicy,
      managementConfiguration,
      dependencies,
      readinessPolicy,
    );
  }
}

export function withRegisteredServiceAvailabilityPolicy(
  service: RegisteredService,
  availabilityPolicy: ServiceAvailabilityPolicy,
): RegisteredService {
  return RegisteredService.create({
    id: service.id,
    displayName: service.displayName,
    managementAdapter: service.managementAdapter,
    externalResourceId: service.externalResourceId,
    supportedOperations: service.supportedOperations,
    availabilityPolicy: serializeAvailabilityPolicy(availabilityPolicy),
    ...(service.managementConfiguration === null
      ? {}
      : { managementConfiguration: service.managementConfiguration }),
    dependencies: service.dependencies,
    readinessPolicy: service.readinessPolicy,
  });
}

function serializeAvailabilityPolicy(
  policy: ServiceAvailabilityPolicy,
): Record<string, unknown> {
  if (policy.mode !== "scheduled") return { mode: policy.mode };

  return {
    mode: policy.mode,
    timezone: policy.timezone,
    windows: policy.schedule.windows,
  };
}

function validateAndGetManagementConfiguration(
  adapter: ServiceManagementAdapter,
  config: unknown,
): DockerComposeManagementConfiguration | null {
  if (adapter === "docker-compose") {
    if (config === undefined) {
      throw new RegisteredServiceValidationError(
        "invalid_management_configuration",
      );
    }

    try {
      return validateDockerComposeManagementConfiguration(config);
    } catch (error) {
      if (error instanceof ManagementConfigurationValidationError) {
        throw new RegisteredServiceValidationError(
          "invalid_management_configuration",
        );
      }
      throw error;
    }
  }

  if (config !== undefined) {
    throw new RegisteredServiceValidationError(
      "invalid_management_configuration",
    );
  }

  return null;
}

function validateAvailabilityPolicy(input: unknown): ServiceAvailabilityPolicy {
  try {
    return createServiceAvailabilityPolicy(input);
  } catch (error) {
    if (
      error instanceof ServiceAvailabilityModeValidationError ||
      error instanceof ServiceAvailabilityPolicyValidationError ||
      error instanceof ServiceScheduleTimezoneValidationError ||
      error instanceof ServiceScheduleValidationError
    ) {
      throw new RegisteredServiceValidationError("invalid_availability_policy");
    }

    throw error;
  }
}

const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const managementAdapterAllowlist = new Set<string>(SERVICE_MANAGEMENT_ADAPTERS);
const supportedOperationAllowlist = new Set<string>(
  SUPPORTED_SERVICE_OPERATIONS,
);

function validateServiceId(id: string): string {
  if (id.length < 1 || id.length > 64 || !SERVICE_ID_PATTERN.test(id)) {
    throw new RegisteredServiceValidationError("invalid_id");
  }

  return id;
}

function validateDisplayName(displayName: string): string {
  if (containsControlCharacter(displayName)) {
    throw new RegisteredServiceValidationError("invalid_display_name");
  }

  const trimmedDisplayName = displayName.trim();
  const characterCount = Array.from(trimmedDisplayName).length;

  if (characterCount < 1 || characterCount > 100) {
    throw new RegisteredServiceValidationError("invalid_display_name");
  }

  return trimmedDisplayName;
}

function validateManagementAdapter(
  managementAdapter: string,
): ServiceManagementAdapter {
  if (!managementAdapterAllowlist.has(managementAdapter)) {
    throw new RegisteredServiceValidationError("invalid_management_adapter");
  }

  return managementAdapter as ServiceManagementAdapter;
}

function validateExternalResourceId(externalResourceId: string): string {
  if (containsControlCharacter(externalResourceId)) {
    throw new RegisteredServiceValidationError("invalid_external_resource_id");
  }

  const trimmedExternalResourceId = externalResourceId.trim();
  const characterCount = Array.from(trimmedExternalResourceId).length;

  if (characterCount < 1 || characterCount > 128) {
    throw new RegisteredServiceValidationError("invalid_external_resource_id");
  }

  return trimmedExternalResourceId;
}

function validateSupportedOperations(
  operations: readonly string[],
): readonly SupportedServiceOperation[] {
  if (operations.length === 0) {
    throw new RegisteredServiceValidationError("invalid_supported_operations");
  }

  const uniqueOperations = new Set<string>();

  for (const operation of operations) {
    if (
      !supportedOperationAllowlist.has(operation) ||
      uniqueOperations.has(operation)
    ) {
      throw new RegisteredServiceValidationError(
        "invalid_supported_operations",
      );
    }

    uniqueOperations.add(operation);
  }

  if (!uniqueOperations.has("readStatus")) {
    throw new RegisteredServiceValidationError("invalid_supported_operations");
  }

  return Object.freeze([...operations]) as readonly SupportedServiceOperation[];
}

function validateDependencies(deps: unknown, ownId: string): readonly string[] {
  if (deps === undefined) {
    return Object.freeze([]);
  }

  if (
    !Array.isArray(deps) ||
    !deps.every((value): value is string => typeof value === "string")
  ) {
    throw new RegisteredServiceValidationError("invalid_dependencies");
  }

  if (deps.length > MAX_DIRECT_DEPENDENCIES_PER_SERVICE) {
    throw new RegisteredServiceValidationError("invalid_dependencies");
  }

  const seen = new Set<string>();

  for (const dep of deps) {
    if (dep.trim() !== dep || dep.length === 0) {
      throw new RegisteredServiceValidationError("invalid_dependencies");
    }

    if (!SERVICE_ID_PATTERN.test(dep) || dep.length > 64) {
      throw new RegisteredServiceValidationError("invalid_dependencies");
    }

    if (dep === ownId) {
      throw new RegisteredServiceValidationError("invalid_dependencies");
    }

    if (seen.has(dep)) {
      throw new RegisteredServiceValidationError("invalid_dependencies");
    }

    seen.add(dep);
  }

  return Object.freeze([...deps]);
}

function validateReadinessPolicy(input: unknown): ReadinessPolicy {
  if (input === undefined) {
    return defaultReadinessPolicy();
  }

  if (!isPlainRecord(input)) {
    throw new RegisteredServiceValidationError("invalid_readiness_policy");
  }

  try {
    return createReadinessPolicy(input);
  } catch (error) {
    if (error instanceof ReadinessPolicyValidationError) {
      throw new RegisteredServiceValidationError("invalid_readiness_policy");
    }
    throw error;
  }
}

const MAX_DIRECT_DEPENDENCIES_PER_SERVICE = 16;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);

    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
