export const SERVICE_MANAGEMENT_ADAPTERS = Object.freeze([
  "mock",
  "pm2",
] as const);

export type ServiceManagementAdapter =
  (typeof SERVICE_MANAGEMENT_ADAPTERS)[number];

export const SUPPORTED_SERVICE_OPERATIONS = Object.freeze([
  "readStatus",
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
  | "invalid_supported_operations";

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
}

export class RegisteredService {
  private constructor(
    public readonly id: string,
    public readonly displayName: string,
    public readonly managementAdapter: ServiceManagementAdapter,
    public readonly externalResourceId: string,
    public readonly supportedOperations: readonly SupportedServiceOperation[],
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

    return new RegisteredService(
      id,
      displayName,
      managementAdapter,
      externalResourceId,
      supportedOperations,
    );
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

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);

    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}
