import { isAbsolute } from "node:path";

export interface BackupManifestFile {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
  readonly sha256: string;
}

export interface BackupManifest {
  readonly schemaVersion: 1;
  readonly targetId: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly files: readonly BackupManifestFile[];
}

export class BackupManifestValidationError extends Error {
  public override readonly name = "BackupManifestValidationError";
  public constructor(public readonly code: string) {
    super(`Invalid backup manifest: ${code}`);
  }
}

export function createBackupManifest(input: unknown): BackupManifest {
  if (!isRecord(input) || Reflect.ownKeys(input).length !== 8)
    throw new BackupManifestValidationError("invalid_shape");
  if (
    input.schemaVersion !== 1 ||
    typeof input.targetId !== "string" ||
    typeof input.runId !== "string" ||
    typeof input.startedAt !== "string" ||
    typeof input.completedAt !== "string" ||
    !Number.isInteger(input.fileCount) ||
    !Number.isInteger(input.totalBytes) ||
    !Array.isArray(input.files) ||
    input.fileCount !== input.files.length ||
    input.fileCount < 0 ||
    (input.totalBytes as number) < 0
  )
    throw new BackupManifestValidationError("invalid_shape");
  const files = input.files.map((file) => createManifestFile(file));
  let previous = "";
  let total = 0;
  for (const file of files) {
    if (file.path <= previous)
      throw new BackupManifestValidationError("unsorted_paths");
    previous = file.path;
    total += file.size;
  }
  if (total !== input.totalBytes)
    throw new BackupManifestValidationError("total_mismatch");
  return Object.freeze({
    schemaVersion: 1,
    targetId: input.targetId,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    fileCount: input.fileCount,
    totalBytes: input.totalBytes,
    files: Object.freeze(files),
  });
}

export function serializeBackupManifest(manifest: BackupManifest): Buffer {
  const value = JSON.stringify(manifest);
  if (Buffer.byteLength(value, "utf8") > 16 * 1024 * 1024)
    throw new BackupManifestValidationError("too_large");
  return Buffer.from(`${value}\n`, "utf8");
}

function createManifestFile(input: unknown): BackupManifestFile {
  if (!isRecord(input) || Reflect.ownKeys(input).length !== 4)
    throw new BackupManifestValidationError("invalid_file");
  const path = input.path;
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 4_096 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    path.startsWith("/")
  )
    throw new BackupManifestValidationError("unsafe_path");
  if (
    !Number.isSafeInteger(input.size) ||
    (input.size as number) < 0 ||
    !Number.isInteger(input.mode) ||
    (input.mode as number) < 0 ||
    (input.mode as number) > 0o777 ||
    typeof input.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(input.sha256)
  )
    throw new BackupManifestValidationError("invalid_file");
  return Object.freeze({
    path,
    size: input.size as number,
    mode: input.mode as number,
    sha256: input.sha256,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
