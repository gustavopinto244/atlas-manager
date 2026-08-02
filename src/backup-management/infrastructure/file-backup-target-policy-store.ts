import {
  chmodSync,
  mkdirSync,
  renameSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  createBackupSchedule,
  createRetention,
  type BackupTarget,
} from "../domain/backup-target.js";
import { parseStrictJson } from "../../config/strict-json.js";
import type { BackupTargetPolicyStore } from "../application/ports/backup-ports.js";

const SCHEMA_VERSION = 1;

export class FileBackupTargetPolicyStore implements BackupTargetPolicyStore {
  readonly #path: string;

  public constructor(destinationRoot: string) {
    this.#path = join(destinationRoot, "target-policies.json");
  }

  public load(targets: readonly BackupTarget[]): readonly BackupTarget[] {
    let data: string;
    try {
      const info = lstatSync(this.#path);
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
        throw new Error("backup_policy_state_unsafe");
      if (info.size > 64 * 1024)
        throw new Error("backup_policy_state_too_large");
      data = readFileSync(this.#path, "utf8");
    } catch (error) {
      if (isMissing(error)) return targets;
      throw error;
    }
    const parsed = parseStrictJson(data);
    if (
      !isRecord(parsed) ||
      Reflect.ownKeys(parsed).length !== 2 ||
      parsed.schemaVersion !== SCHEMA_VERSION ||
      !Array.isArray(parsed.targets)
    )
      throw new Error("backup_policy_state_invalid");
    if (parsed.targets.length !== targets.length)
      throw new Error("backup_policy_state_invalid");
    const byId = new Map(targets.map((target) => [target.id, target]));
    const seen = new Set<string>();
    for (const entry of parsed.targets) {
      if (
        !isRecord(entry) ||
        Reflect.ownKeys(entry).length !== 3 ||
        typeof entry.id !== "string" ||
        !Object.hasOwn(entry, "schedule") ||
        !Object.hasOwn(entry, "retention") ||
        seen.has(entry.id)
      )
        throw new Error("backup_policy_state_invalid");
      const target = byId.get(entry.id);
      if (target === undefined) throw new Error("backup_policy_state_invalid");
      seen.add(entry.id);
      byId.set(
        entry.id,
        Object.freeze({
          ...target,
          schedule: createBackupSchedule(entry.schedule),
          retention: createRetention(entry.retention),
        }),
      );
    }
    return Object.freeze(targets.map((target) => byId.get(target.id)!));
  }

  public save(targets: readonly BackupTarget[]): void {
    const directory = dirname(this.#path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const data = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      targets: targets.map((target) => ({
        id: target.id,
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
      })),
    });
    const temporary = `${this.#path}.tmp`;
    writeFileSync(temporary, `${data}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(temporary, 0o600);
    try {
      renameSync(temporary, this.#path);
    } catch (error) {
      try {
        // A failed publication must not leave a second managed policy file.
        lstatSync(temporary);
      } catch {
        throw error;
      }
      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
