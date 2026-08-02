import { parseStrictJson } from "../../config/strict-json.js";
import {
  createBackupTarget,
  type BackupTarget,
} from "../domain/backup-target.js";
import { InMemoryBackupTargetCatalog } from "./in-memory-backup-target-catalog.js";

export const REGISTERED_BACKUP_TARGETS_VARIABLE =
  "REGISTERED_BACKUP_TARGETS_JSON";
export const MAX_REGISTERED_BACKUP_TARGETS = 100;
export const MAX_REGISTERED_BACKUP_TARGETS_JSON_BYTES = 65_536;

export class BackupTargetConfigurationError extends Error {
  public override readonly name = "BackupTargetConfigurationError";
  public constructor(public readonly code: string) {
    super(`Invalid registered backup target configuration: ${code}`);
  }
}

export function createBackupTargetCatalogFromEnvironment(
  environment: Readonly<Record<string, unknown>>,
): InMemoryBackupTargetCatalog {
  const configured = environment[REGISTERED_BACKUP_TARGETS_VARIABLE];
  if (configured === undefined || configured === "")
    return InMemoryBackupTargetCatalog.create([]);
  if (typeof configured !== "string")
    throw new BackupTargetConfigurationError("targets_invalid_shape");
  if (
    Buffer.byteLength(configured, "utf8") >
    MAX_REGISTERED_BACKUP_TARGETS_JSON_BYTES
  )
    throw new BackupTargetConfigurationError("targets_too_large");
  let parsed: unknown;
  try {
    parsed = parseStrictJson(configured);
  } catch {
    throw new BackupTargetConfigurationError("targets_invalid_json");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_REGISTERED_BACKUP_TARGETS)
    throw new BackupTargetConfigurationError("targets_invalid_shape");
  const targets = parsed.map((entry) => {
    try {
      if (!isRecord(entry)) throw new Error();
      const allowed = new Set([
        "id",
        "displayName",
        "kind",
        "sourcePath",
        "schedule",
        "retention",
        "limits",
      ]);
      if (
        !Reflect.ownKeys(entry).every(
          (key) => typeof key === "string" && allowed.has(key),
        )
      )
        throw new Error();
      return createBackupTarget(
        entry as {
          readonly id: string;
          readonly displayName: string;
          readonly kind: string;
          readonly sourcePath?: string;
          readonly schedule: unknown;
          readonly retention: unknown;
          readonly limits: unknown;
        },
      );
    } catch {
      throw new BackupTargetConfigurationError("target_invalid");
    }
  });
  try {
    return InMemoryBackupTargetCatalog.create(targets);
  } catch {
    throw new BackupTargetConfigurationError("catalog_invalid");
  }
}

export function serializeBackupTargets(
  targets: readonly BackupTarget[],
): string {
  return JSON.stringify(
    targets.map((target) => ({
      id: target.id,
      displayName: target.displayName,
      kind: target.kind,
      ...(target.sourcePath === null ? {} : { sourcePath: target.sourcePath }),
      schedule:
        target.schedule.mode === "scheduled"
          ? {
              mode: "scheduled",
              timezone: target.schedule.timezone,
              windows: target.schedule.schedule?.windows,
            }
          : { mode: target.schedule.mode },
      retention: {
        keepLastSuccessful: target.retention.keepLastSuccessful,
        ...(target.retention.maxSuccessfulAgeDays === null
          ? {}
          : { maxSuccessfulAgeDays: target.retention.maxSuccessfulAgeDays }),
      },
      limits: target.limits,
    })),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
