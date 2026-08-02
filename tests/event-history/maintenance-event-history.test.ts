import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileAdministrativeEventHistory } from "../../src/event-history/infrastructure/file-administrative-event-history.js";
import { FileSegmentedAdministrativeEventHistory } from "../../src/event-history/infrastructure/file-segmented-administrative-event-history.js";
import {
  EVENT_HISTORY_MIGRATION_CONFIRMATION,
  migrateVersionOneEventHistory,
  type EventHistoryMaintenancePaths,
} from "../../src/maintenance/event-history.js";

function event() {
  return {
    attemptId: "00000000-0000-4000-8000-000000000001",
    occurredAt: "2026-08-02T12:00:00.000Z",
    source: {
      kind: "administrative" as const,
      actorId: "unattributed-local" as const,
    },
    target: { kind: "machine" as const, id: "atlas" as const },
    operation: "authorize_administrative_operation" as const,
    status: "succeeded" as const,
    details: {
      requestedOperation: "read_wake_alarm" as const,
      permission: "power.wake.read" as const,
      decision: "allowed" as const,
    },
  };
}

describe("event-history maintenance", () => {
  it("migrates a version-one source and makes the second run unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-event-history-migration-"));
    try {
      const sourcePath = join(root, "admin-events.jsonl");
      const targetPath = join(root, "v2");
      const lockPath = join(root, "writer.lock");
      const source = new FileAdministrativeEventHistory(sourcePath);
      await source.record(event());
      const paths: EventHistoryMaintenancePaths = {
        root: targetPath,
        versionOneFile: sourcePath,
        writerLock: lockPath,
        clock: () => "2026-08-02T12:00:00.000Z",
      };
      const first = await migrateVersionOneEventHistory(
        EVENT_HISTORY_MIGRATION_CONFIRMATION,
        paths,
      );
      expect(first).toMatchObject({ outcome: "migrated", eventCount: 1 });
      const second = await migrateVersionOneEventHistory(
        EVENT_HISTORY_MIGRATION_CONFIRMATION,
        paths,
      );
      expect(second).toMatchObject({
        outcome: "unchanged",
        eventCount: 1,
        sourceSha256: first.sourceSha256,
      });
      const target = new FileSegmentedAdministrativeEventHistory(targetPath, {
        lockPath: join(root, "verify.lock"),
        ...(paths.clock === undefined ? {} : { clock: paths.clock }),
      });
      expect((await target.verifyIntegrity()).outcome).toBe("verified");
      expect((await target.query()).events).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
