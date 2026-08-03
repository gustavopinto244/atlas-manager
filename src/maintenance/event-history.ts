import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { FileAdministrativeEventHistory } from "../event-history/infrastructure/file-administrative-event-history.js";
import { FileSegmentedAdministrativeEventHistory } from "../event-history/infrastructure/file-segmented-administrative-event-history.js";
import {
  canonicalJson,
  sha256,
} from "../event-history/domain/event-history-record.js";
import { FileEventHistoryWriterLock } from "../event-history/infrastructure/file-event-history-writer-lock.js";
import { parseStrictJson } from "../config/strict-json.js";

export const EVENT_HISTORY_PRODUCTION_ROOT =
  "/var/lib/atlas-manager-event-history";
export const EVENT_HISTORY_VERSION_ONE_FILE =
  "/var/lib/atlas-manager/admin-events.jsonl";
export const EVENT_HISTORY_WRITER_LOCK =
  "/run/atlas-manager/event-history-writer.lock";
export const EVENT_HISTORY_MIGRATION_CONFIRMATION =
  "confirm_administrative_event_history_v1_migration";
export const EVENT_HISTORY_STALE_LOCK_CONFIRMATION =
  "confirm_administrative_event_history_stale_lock_recovery";

export interface EventHistoryMaintenancePaths {
  readonly root: string;
  readonly versionOneFile: string;
  readonly writerLock: string;
  readonly clock?: () => string;
}

const productionPaths: EventHistoryMaintenancePaths = Object.freeze({
  root: EVENT_HISTORY_PRODUCTION_ROOT,
  versionOneFile: EVENT_HISTORY_VERSION_ONE_FILE,
  writerLock: EVENT_HISTORY_WRITER_LOCK,
});

export type EventHistoryMaintenanceState =
  | "fresh"
  | "version_one_present"
  | "version_two_ready"
  | "busy"
  | "stale_lock"
  | "interrupted"
  | "broken";

export function inspectEventHistoryMaintenance(): EventHistoryMaintenanceState {
  if (existsSync(join(EVENT_HISTORY_PRODUCTION_ROOT, "transaction.json")))
    return "interrupted";
  if (existsSync(EVENT_HISTORY_WRITER_LOCK))
    return classifyLock(EVENT_HISTORY_WRITER_LOCK);
  if (existsSync(EVENT_HISTORY_PRODUCTION_ROOT)) {
    return "version_two_ready";
  }
  return existsSync(EVENT_HISTORY_VERSION_ONE_FILE)
    ? "version_one_present"
    : "fresh";
}

export async function migrateVersionOneEventHistory(
  confirmation: string,
  paths: EventHistoryMaintenancePaths = productionPaths,
): Promise<
  Readonly<{
    outcome: "migrated" | "unchanged";
    eventCount: number;
    sourceSha256: string;
  }>
> {
  if (confirmation !== EVENT_HISTORY_MIGRATION_CONFIRMATION)
    throw new Error("confirmation_invalid");
  if (!existsSync(paths.versionOneFile))
    throw new Error("event_history_migration_required");
  const lock = new FileEventHistoryWriterLock(paths.writerLock);
  const lockState = lock.inspect();
  if (lockState.state === "busy") throw new Error("event_history_writer_busy");
  if (lockState.state === "stale")
    throw new Error("event_history_writer_stale");
  if (lockState.state === "invalid")
    throw new Error("event_history_writer_invalid");
  const handle = lock.acquire("migrate-v1");
  const source = readFileSync(paths.versionOneFile);
  const sourceSha256 = sha256(source);
  try {
    const receiptPath = join(
      paths.root,
      "migration",
      "version-one-migration-receipt.json",
    );
    if (existsSync(receiptPath)) {
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as {
        sourceSha256?: string;
        sourceEventCount?: number;
      };
      if (receipt.sourceSha256 === sourceSha256)
        return Object.freeze({
          outcome: "unchanged" as const,
          eventCount: receipt.sourceEventCount ?? 0,
          sourceSha256,
        });
      throw new Error("event_history_migration_failed");
    }
    if (existsSync(paths.root) || existsSync(`${paths.root}.candidate`))
      throw new Error("event_history_migration_failed");
    const sourceStore = new FileAdministrativeEventHistory(
      paths.versionOneFile,
    );
    const events = [];
    let afterSequence = 0;
    while (true) {
      const page = await sourceStore.query({ afterSequence, limit: 100 });
      events.push(...page.events);
      if (!page.hasMore || page.events.length === 0) break;
      afterSequence = page.events.at(-1)!.sequence;
    }
    if (sha256(readFileSync(paths.versionOneFile)) !== sourceSha256)
      throw new Error("event_history_migration_failed");
    const candidateRoot = `${paths.root}.candidate`;
    mkdirSync(dirname(paths.root), { recursive: true, mode: 0o700 });
    const target = new FileSegmentedAdministrativeEventHistory(candidateRoot, {
      lockPath: join(
        dirname(paths.root),
        `.${basename(paths.root)}-migration-writer.lock`,
      ),
      ...(paths.clock === undefined ? {} : { clock: paths.clock }),
    });
    for (const event of events) {
      const { sequence, ...input } = event;
      void sequence;
      await target.record(input);
    }
    const integrity = await target.verifyIntegrity();
    if (integrity.outcome !== "verified")
      throw new Error("event_history_migration_failed");
    const migration = join(candidateRoot, "migration");
    mkdirSync(migration, { recursive: true, mode: 0o700 });
    const receipt = Buffer.from(
      `${canonicalJson({ schemaVersion: 1, sourceSha256, sourceEventCount: events.length, firstSequence: events[0]?.sequence ?? 0, lastSequence: events.at(-1)?.sequence ?? 0, versionTwoChainHead: integrity.lastRecordSha256 ?? "0".repeat(64), migratedAt: paths.clock?.() ?? new Date().toISOString(), result: "migrated" })}\n`,
      "utf8",
    );
    writeFileSync(
      join(migration, "version-one-migration-receipt.json"),
      receipt,
      { mode: 0o600, flag: "wx" },
    );
    const receiptCheck = parseStrictJson(
      readFileSync(
        join(migration, "version-one-migration-receipt.json"),
        "utf8",
      ),
    );
    if (typeof receiptCheck !== "object" || receiptCheck === null)
      throw new Error("event_history_migration_failed");
    if (sha256(readFileSync(paths.versionOneFile)) !== sourceSha256)
      throw new Error("event_history_migration_failed");
    renameSync(candidateRoot, paths.root);
    const finalStore = new FileSegmentedAdministrativeEventHistory(paths.root, {
      lockPath: join(
        dirname(paths.root),
        `.${basename(paths.root)}-migration-final.lock`,
      ),
      ...(paths.clock === undefined ? {} : { clock: paths.clock }),
    });
    if ((await finalStore.verifyIntegrity()).outcome !== "verified")
      throw new Error("event_history_migration_failed");
    return Object.freeze({
      outcome: "migrated" as const,
      eventCount: events.length,
      sourceSha256,
    });
  } finally {
    if (existsSync(`${paths.root}.candidate`) && !existsSync(paths.root))
      rmSync(`${paths.root}.candidate`, { recursive: true, force: true });
    lock.release(handle.token);
  }
}

export function recoverStaleEventHistoryLock(
  confirmation: string,
  paths: EventHistoryMaintenancePaths = productionPaths,
): Readonly<{ outcome: "recovered" }> {
  if (confirmation !== EVENT_HISTORY_STALE_LOCK_CONFIRMATION)
    throw new Error("confirmation_invalid");
  const lock = new FileEventHistoryWriterLock(paths.writerLock);
  if (lock.inspect().state !== "stale")
    throw new Error("event_history_writer_busy");
  if (existsSync(join(paths.root, "transaction.json")))
    throw new Error("event_history_interrupted");
  rmSync(paths.writerLock, { recursive: true, force: false });
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(paths.root, "stale-lock-recovery-receipt.json"),
    `${canonicalJson({ schemaVersion: 1, result: "recovered", recoveredAt: paths.clock?.() ?? new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
  return Object.freeze({ outcome: "recovered" as const });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "inspect") {
    process.stdout.write(
      `${canonicalJson({ state: inspectEventHistoryMaintenance() })}\n`,
    );
    return;
  }
  if (args.length === 1 && args[0] === "verify") {
    const store = new FileSegmentedAdministrativeEventHistory(
      EVENT_HISTORY_PRODUCTION_ROOT,
      { lockPath: EVENT_HISTORY_WRITER_LOCK },
    );
    process.stdout.write(`${canonicalJson(await store.verifyIntegrity())}\n`);
    return;
  }
  const migrationArgument = args[1];
  if (
    args.length === 2 &&
    args[0] === "migrate-v1" &&
    typeof migrationArgument === "string" &&
    migrationArgument.startsWith("--confirmation=")
  ) {
    process.stdout.write(
      `${canonicalJson(await migrateVersionOneEventHistory(migrationArgument.slice("--confirmation=".length)))}\n`,
    );
    return;
  }
  if (
    args.length === 2 &&
    args[0] === "recover-stale-lock" &&
    typeof migrationArgument === "string" &&
    migrationArgument.startsWith("--confirmation=")
  ) {
    process.stdout.write(
      `${canonicalJson(recoverStaleEventHistoryLock(migrationArgument.slice("--confirmation=".length)))}\n`,
    );
    return;
  }
  throw new Error("unsupported_action");
}

function classifyLock(path: string): EventHistoryMaintenanceState {
  const state = new FileEventHistoryWriterLock(path).inspect().state;
  return state === "busy"
    ? "busy"
    : state === "stale"
      ? "stale_lock"
      : state === "invalid"
        ? "broken"
        : "fresh";
}

void (import.meta.url === `file://${process.argv[1]}`
  ? main().catch(() => {
      process.exitCode = 1;
    })
  : undefined);
