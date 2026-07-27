import { sep, normalize, isAbsolute } from "node:path";

export interface DockerComposeManagementConfiguration {
  readonly composeFile: string;
  readonly projectDirectory: string;
}

export type ManagementConfiguration = Readonly<{
  composeFile?: unknown;
  projectDirectory?: unknown;
}>;

export class ManagementConfigurationValidationError extends Error {
  public constructor(
    public readonly code:
      | "unsupported_for_adapter"
      | "missing_for_adapter"
      | "invalid_compose_file"
      | "invalid_project_directory"
      | "path_escape"
      | "unknown_field"
      | "invalid_input_type",
    message?: string,
  ) {
    super(message ?? `Management configuration validation failed: ${code}`);
    this.name = "ManagementConfigurationValidationError";
    Object.freeze(this);
  }
}

export function validateDockerComposeManagementConfiguration(
  input: unknown,
): DockerComposeManagementConfiguration {
  if (!isPlainObject(input)) {
    throw new ManagementConfigurationValidationError("invalid_input_type");
  }

  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);

  for (const key of keys) {
    if (key !== "composeFile" && key !== "projectDirectory") {
      throw new ManagementConfigurationValidationError("unknown_field");
    }
  }

  if (keys.length !== 2) {
    throw new ManagementConfigurationValidationError("missing_for_adapter");
  }

  const rawComposeFile = obj.composeFile;
  const rawProjectDirectory = obj.projectDirectory;

  if (typeof rawComposeFile !== "string") {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }

  if (typeof rawProjectDirectory !== "string") {
    throw new ManagementConfigurationValidationError(
      "invalid_project_directory",
    );
  }

  const composeFile = validateComposePath(rawComposeFile);
  const projectDirectory = validateProjectPath(rawProjectDirectory);

  if (composeFile.length > 4096 || projectDirectory.length > 4096) {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }

  if (!isAbsolute(composeFile)) {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }

  if (!isAbsolute(projectDirectory)) {
    throw new ManagementConfigurationValidationError(
      "invalid_project_directory",
    );
  }

  if (composeFile === projectDirectory) {
    throw new ManagementConfigurationValidationError("path_escape");
  }

  const normalizedCompose = normalize(composeFile);
  const normalizedDir = normalize(projectDirectory);

  if (!isAbsolute(normalizedCompose) || !isAbsolute(normalizedDir)) {
    throw new ManagementConfigurationValidationError("path_escape");
  }

  if (normalizedCompose === "/") {
    throw new ManagementConfigurationValidationError("path_escape");
  }

  if (!normalizedCompose.startsWith(normalizedDir + sep)) {
    throw new ManagementConfigurationValidationError("path_escape");
  }

  return Object.freeze({
    composeFile: normalizedCompose,
    projectDirectory: normalizedDir,
  });
}

function validateComposePath(value: string): string {
  if (value !== value.trim()) {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }
  if (containsControlCharacter(value)) {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }
  if (value.length === 0) {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }
  return value;
}

function validateProjectPath(value: string): string {
  if (value !== value.trim()) {
    throw new ManagementConfigurationValidationError(
      "invalid_project_directory",
    );
  }
  if (containsControlCharacter(value)) {
    throw new ManagementConfigurationValidationError(
      "invalid_project_directory",
    );
  }
  if (value.length === 0) {
    throw new ManagementConfigurationValidationError(
      "invalid_project_directory",
    );
  }
  return value;
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

function isPlainObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
