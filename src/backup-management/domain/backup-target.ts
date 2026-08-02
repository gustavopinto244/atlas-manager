import { isAbsolute, normalize, relative, resolve } from "node:path";

import {
  createServiceScheduleTimezone,
  type ServiceScheduleTimezone,
} from "../../service-scheduling/domain/service-schedule-timezone.js";
import {
  createWeeklyAvailabilitySchedule,
  type WeeklyAvailabilitySchedule,
} from "../../service-scheduling/domain/weekly-availability-schedule.js";
import type { WeeklyAvailabilityWindowInput } from "../../service-scheduling/domain/weekly-availability-window.js";

export const BACKUP_TARGET_KINDS = Object.freeze([
  "mock",
  "filesystem_tree",
] as const);
export type BackupTargetKind = (typeof BACKUP_TARGET_KINDS)[number];

export const BACKUP_SCHEDULE_MODES = Object.freeze([
  "manual",
  "scheduled",
  "disabled",
] as const);
export type BackupScheduleMode = (typeof BACKUP_SCHEDULE_MODES)[number];

export const BACKUP_DESTINATION_ROOT = "/var/lib/atlas-manager-backups";
export const BACKUP_MAX_FILES = 100_000;
export const BACKUP_MAX_TOTAL_BYTES = 100 * 1024 * 1024 * 1024;
export const BACKUP_MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;
export const BACKUP_MAX_DEPTH = 64;
export const BACKUP_MAX_RELATIVE_PATH_BYTES = 4_096;

export interface BackupLimits {
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxFileBytes: number;
  readonly maxDepth: number;
  readonly maxRelativePathBytes: number;
}

export interface BackupRetentionPolicy {
  readonly keepLastSuccessful: number;
  readonly maxSuccessfulAgeDays: number | null;
}

export interface BackupSchedule {
  readonly mode: BackupScheduleMode;
  readonly timezone: ServiceScheduleTimezone | null;
  readonly schedule: WeeklyAvailabilitySchedule | null;
}

export interface BackupTarget {
  readonly id: string;
  readonly displayName: string;
  readonly kind: BackupTargetKind;
  readonly sourcePath: string | null;
  readonly schedule: BackupSchedule;
  readonly retention: BackupRetentionPolicy;
  readonly limits: BackupLimits;
}

export interface CreateBackupTargetInput {
  readonly id: string;
  readonly displayName: string;
  readonly kind: string;
  readonly sourcePath?: string;
  readonly schedule: unknown;
  readonly retention: unknown;
  readonly limits: unknown;
}

export class BackupTargetValidationError extends Error {
  public override readonly name = "BackupTargetValidationError";
  public constructor(public readonly code: string) {
    super(`Invalid backup target: ${code}`);
    Object.freeze(this);
  }
}

export function createBackupTarget(
  input: CreateBackupTargetInput,
): BackupTarget {
  if (!isRecord(input) || !hasExactTargetShape(input))
    throw new BackupTargetValidationError("invalid_shape");
  if (
    !isTargetId(input.id) ||
    typeof input.displayName !== "string" ||
    input.displayName.length < 1 ||
    input.displayName.length > 128 ||
    input.displayName.trim() !== input.displayName
  )
    throw new BackupTargetValidationError("invalid_identity");
  if (
    typeof input.kind !== "string" ||
    !(BACKUP_TARGET_KINDS as readonly string[]).includes(input.kind)
  )
    throw new BackupTargetValidationError("invalid_kind");
  const kind = input.kind as BackupTargetKind;
  if (kind === "filesystem_tree") {
    if (input.sourcePath === undefined) {
      throw new BackupTargetValidationError("source_required");
    }
    validateSourcePath(input.sourcePath);
  } else if (Object.hasOwn(input, "sourcePath")) {
    throw new BackupTargetValidationError("source_not_allowed");
  }
  return Object.freeze({
    id: input.id,
    displayName: input.displayName,
    kind,
    sourcePath: input.sourcePath ?? null,
    schedule: createBackupSchedule(input.schedule),
    retention: createRetention(input.retention),
    limits: createLimits(input.limits),
  });
}

export function createBackupSchedule(input: unknown): BackupSchedule {
  if (!isRecord(input))
    throw new BackupTargetValidationError("invalid_schedule");
  const mode = input.mode;
  if (!(BACKUP_SCHEDULE_MODES as readonly unknown[]).includes(mode))
    throw new BackupTargetValidationError("invalid_schedule");
  if (mode !== "scheduled") {
    if (Reflect.ownKeys(input).length !== 1)
      throw new BackupTargetValidationError("invalid_schedule");
    return Object.freeze({
      mode: mode as Exclude<BackupScheduleMode, "scheduled">,
      timezone: null,
      schedule: null,
    });
  }
  if (
    Reflect.ownKeys(input).length !== 3 ||
    typeof input.timezone !== "string" ||
    !Array.isArray(input.windows)
  )
    throw new BackupTargetValidationError("invalid_schedule");
  try {
    return Object.freeze({
      mode: "scheduled",
      timezone: createServiceScheduleTimezone(input.timezone),
      schedule: createWeeklyAvailabilitySchedule(
        input.windows as readonly WeeklyAvailabilityWindowInput[],
      ),
    });
  } catch {
    throw new BackupTargetValidationError("invalid_schedule");
  }
}

export function createRetention(input: unknown): BackupRetentionPolicy {
  if (!isRecord(input))
    throw new BackupTargetValidationError("invalid_retention");
  const keepLastSuccessful = input.keepLastSuccessful;
  if (
    Reflect.ownKeys(input).length < 1 ||
    Reflect.ownKeys(input).length > 2 ||
    !Number.isInteger(input.keepLastSuccessful) ||
    (keepLastSuccessful as number) < 1 ||
    (keepLastSuccessful as number) > 100
  )
    throw new BackupTargetValidationError("invalid_retention");
  const age = input.maxSuccessfulAgeDays;
  if (
    age !== undefined &&
    (!Number.isInteger(age) || (age as number) < 1 || (age as number) > 3_650)
  )
    throw new BackupTargetValidationError("invalid_retention");
  if (age === undefined && Reflect.ownKeys(input).length !== 1)
    throw new BackupTargetValidationError("invalid_retention");
  return Object.freeze({
    keepLastSuccessful: keepLastSuccessful as number,
    maxSuccessfulAgeDays: (age as number | undefined) ?? null,
  });
}

export function createLimits(input: unknown): BackupLimits {
  if (!isRecord(input) || Reflect.ownKeys(input).length !== 5)
    throw new BackupTargetValidationError("invalid_limits");
  const limits = {
    maxFiles: input.maxFiles as number,
    maxTotalBytes: input.maxTotalBytes as number,
    maxFileBytes: input.maxFileBytes as number,
    maxDepth: input.maxDepth as number,
    maxRelativePathBytes: input.maxRelativePathBytes as number,
  };
  if (
    !Number.isInteger(limits.maxFiles) ||
    limits.maxFiles < 1 ||
    limits.maxFiles > BACKUP_MAX_FILES ||
    !Number.isInteger(limits.maxTotalBytes) ||
    limits.maxTotalBytes < 1 ||
    limits.maxTotalBytes > BACKUP_MAX_TOTAL_BYTES ||
    !Number.isInteger(limits.maxFileBytes) ||
    limits.maxFileBytes < 1 ||
    limits.maxFileBytes > BACKUP_MAX_FILE_BYTES ||
    !Number.isInteger(limits.maxDepth) ||
    limits.maxDepth < 1 ||
    limits.maxDepth > BACKUP_MAX_DEPTH ||
    !Number.isInteger(limits.maxRelativePathBytes) ||
    limits.maxRelativePathBytes < 1 ||
    limits.maxRelativePathBytes > BACKUP_MAX_RELATIVE_PATH_BYTES
  )
    throw new BackupTargetValidationError("invalid_limits");
  return Object.freeze(limits);
}

export function validateSourcePath(value: string): void {
  if (
    !isAbsolute(value) ||
    value.trim() !== value ||
    value === "/" ||
    normalize(value) !== value ||
    value.includes("\0")
  )
    throw new BackupTargetValidationError("invalid_source_path");
  const normalized = resolve(value);
  const forbidden = ["/proc", "/sys", "/dev", "/run"];
  if (
    forbidden.some(
      (root) =>
        normalized === root ||
        (relative(root, normalized) !== "" &&
          !relative(root, normalized).startsWith("..")),
    )
  )
    throw new BackupTargetValidationError("invalid_source_path");
  const destination = resolve(BACKUP_DESTINATION_ROOT);
  const destinationRelative = relative(destination, normalized);
  const sourceRelative = relative(normalized, destination);
  if (
    destinationRelative === "" ||
    !destinationRelative.startsWith("..") ||
    sourceRelative === "" ||
    !sourceRelative.startsWith("..")
  )
    throw new BackupTargetValidationError("source_destination_overlap");
}

function hasExactTargetShape(input: Record<string, unknown>): boolean {
  const allowed = new Set([
    "id",
    "displayName",
    "kind",
    "sourcePath",
    "schedule",
    "retention",
    "limits",
  ]);
  const required = [
    "id",
    "displayName",
    "kind",
    "schedule",
    "retention",
    "limits",
  ];
  return (
    required.every((key) => Object.hasOwn(input, key)) &&
    Reflect.ownKeys(input).every(
      (key) => typeof key === "string" && allowed.has(key),
    )
  );
}

function isTargetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) &&
    value.length <= 64
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
