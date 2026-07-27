export interface DockerComposeManagementConfiguration {
  readonly composeFile: string;
  readonly projectDirectory: string;
}

export type ManagementConfiguration = Readonly<{
  composeFile?: string;
  projectDirectory?: string;
}>;

export class ManagementConfigurationValidationError extends Error {
  public constructor(
    public readonly code:
      | "unsupported_for_adapter"
      | "missing_for_adapter"
      | "invalid_compose_file"
      | "invalid_project_directory"
      | "path_escape"
      | "unknown_field",
    message?: string,
  ) {
    super(message ?? `Management configuration validation failed: ${code}`);
    this.name = "ManagementConfigurationValidationError";
    Object.freeze(this);
  }
}

export function validateDockerComposeManagementConfiguration(
  input: ManagementConfiguration,
): DockerComposeManagementConfiguration {
  const keys = Object.keys(input);

  for (const key of keys) {
    if (key !== "composeFile" && key !== "projectDirectory") {
      throw new ManagementConfigurationValidationError("unknown_field");
    }
  }

  if (keys.length !== 2) {
    throw new ManagementConfigurationValidationError("missing_for_adapter");
  }

  const { composeFile, projectDirectory } = input;

  if (typeof composeFile !== "string" || composeFile.trim() === "") {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }

  if (typeof projectDirectory !== "string" || projectDirectory.trim() === "") {
    throw new ManagementConfigurationValidationError(
      "invalid_project_directory",
    );
  }

  const trimmedComposeFile = composeFile.trim();
  const trimmedProjectDirectory = projectDirectory.trim();

  if (containsControlCharacter(trimmedComposeFile)) {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }

  if (containsControlCharacter(trimmedProjectDirectory)) {
    throw new ManagementConfigurationValidationError(
      "invalid_project_directory",
    );
  }

  if (
    trimmedComposeFile.length > 4096 ||
    trimmedProjectDirectory.length > 4096
  ) {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }

  if (!isAbsolutePath(trimmedComposeFile)) {
    throw new ManagementConfigurationValidationError("invalid_compose_file");
  }

  if (!isAbsolutePath(trimmedProjectDirectory)) {
    throw new ManagementConfigurationValidationError(
      "invalid_project_directory",
    );
  }

  if (escapesDirectory(trimmedComposeFile, trimmedProjectDirectory)) {
    throw new ManagementConfigurationValidationError("path_escape");
  }

  return Object.freeze({
    composeFile: trimmedComposeFile,
    projectDirectory: trimmedProjectDirectory,
  });
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function escapesDirectory(filePath: string, directory: string): boolean {
  const normalizedFile = filePath.replace(/\/+$/, "");
  const normalizedDir = directory.replace(/\/+$/, "");

  if (!normalizedFile.startsWith(normalizedDir + "/")) {
    return true;
  }

  const relativePath = normalizedFile.slice(normalizedDir.length + 1);
  const segments = relativePath.split("/");

  return segments.some((segment) => segment === ".." || segment === ".");
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
