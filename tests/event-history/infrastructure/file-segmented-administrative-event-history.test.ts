import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileSegmentedAdministrativeEventHistory } from "../../../src/event-history/infrastructure/file-segmented-administrative-event-history.js";

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "atlas-event-history-v2-"));
}

function event(index: number) {
  return {
    attemptId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    occurredAt: "2026-08-01T12:00:00.000Z",
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

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

describe("FileSegmentedAdministrativeEventHistory", () => {
  it("writes version-two records with a canonical chain and verifies them", async () => {
    const root = fixture();
    try {
      const store = new FileSegmentedAdministrativeEventHistory(root);
      await store.record(event(1));
      await store.record(event(2));
      const page = await store.query();
      expect(page.events.map((value) => value.sequence)).toEqual([1, 2]);
      const integrity = await store.verifyIntegrity();
      expect(integrity.outcome).toBe("verified");
      expect(integrity.latestSequence).toBe(2);
      expect(readFileSync(join(root, "active.jsonl"), "utf8")).toContain(
        '"schemaVersion":2',
      );
      expect(statSync(join(root, "active.jsonl")).mode & 0o777).toBe(0o600);
    } finally {
      cleanup(root);
    }
  });

  it("rotates before the configured event limit and preserves sequence continuity", async () => {
    const root = fixture();
    try {
      const store = new FileSegmentedAdministrativeEventHistory(root, {
        maxSegmentEvents: 100,
        maxSegmentBytes: 1_048_576,
      });
      for (let index = 1; index <= 101; index += 1)
        await store.record(event(index));
      const integrity = await store.verifyIntegrity();
      expect(integrity.outcome).toBe("verified");
      expect(integrity.sealedSegmentCount).toBe(1);
      expect(integrity.latestSequence).toBe(101);
      expect(
        (await store.query({ afterSequence: 99, limit: 10 })).events.map(
          (value) => value.sequence,
        ),
      ).toEqual([100, 101]);
    } finally {
      cleanup(root);
    }
  });

  it("detects record tampering and blocks subsequent writes", async () => {
    const root = fixture();
    try {
      const store = new FileSegmentedAdministrativeEventHistory(root);
      await store.record(event(1));
      const path = join(root, "active.jsonl");
      const original = readFileSync(path, "utf8");
      const content = original.replace(
        /("recordSha256":"[0-9a-f]{63})[0-9a-f](")/u,
        "$10$2",
      );
      writeFileSync(path, content, { mode: 0o600 });
      await expect(store.verifyIntegrity()).resolves.toMatchObject({
        outcome: "broken",
      });
      await expect(store.record(event(2))).rejects.toMatchObject({
        code: "event_history_corrupted",
      });
    } finally {
      cleanup(root);
    }
  });

  it("creates deterministic exports and anchors retained history", async () => {
    const root = fixture();
    try {
      const clock = () => "2026-08-02T12:00:00.000Z";
      const store = new FileSegmentedAdministrativeEventHistory(root, {
        clock,
        maxSegmentEvents: 100,
        maxSegmentBytes: 1_048_576,
        retentionPolicy: {
          schemaVersion: 1,
          automaticPruneEnabled: false,
          segments: {
            minSealedSegments: 1,
            maxSealedSegments: 1,
            maxSealedSegmentAgeDays: 365,
          },
          exports: { minExports: 0, maxExports: 10, maxExportAgeDays: 365 },
        },
      });
      for (let index = 1; index <= 301; index += 1)
        await store.record(event(index));
      const exportResult = await store.createExport({
        fromSequence: 1,
        throughSequence: 100,
      });
      expect(exportResult.outcome).toBe("created");
      expect(
        (await store.readExport(exportResult.metadata.exportId)).toString(
          "utf8",
        ),
      ).toContain('"kind":"atlas-manager-event-history-export"');
      expect((await store.pruneSegments()).outcome).toBe("pruned");
      expect((await store.verifyIntegrity()).outcome).toBe(
        "verified_with_retention",
      );
      for (let index = 302; index <= 401; index += 1)
        await store.record(event(index));
      expect((await store.pruneSegments()).outcome).toBe("pruned");
      expect((await store.verifyIntegrity()).outcome).toBe(
        "verified_with_retention",
      );
      const reconstructed = new FileSegmentedAdministrativeEventHistory(root, {
        clock,
        maxSegmentEvents: 100,
        maxSegmentBytes: 1_048_576,
        retentionPolicy: {
          schemaVersion: 1,
          automaticPruneEnabled: false,
          segments: {
            minSealedSegments: 1,
            maxSealedSegments: 1,
            maxSealedSegmentAgeDays: 365,
          },
          exports: { minExports: 0, maxExports: 10, maxExportAgeDays: 365 },
        },
      });
      expect((await reconstructed.verifyIntegrity()).outcome).toBe(
        "verified_with_retention",
      );
      const laterExport = await reconstructed.createExport({
        fromSequence: 301,
        throughSequence: 305,
      });
      expect(laterExport.outcome).toBe("created");
      await expect(store.query({ afterSequence: 1 })).rejects.toMatchObject({
        code: "event_history_history_pruned",
      });
      const page = await store.query({ afterSequence: 300, limit: 5 });
      expect(page.events.map((value) => value.sequence)).toEqual([
        301, 302, 303, 304, 305,
      ]);
    } finally {
      cleanup(root);
    }
  }, 15_000);

  it("keeps read-only inspection non-mutating and rejects unknown root entries", async () => {
    const root = fixture();
    try {
      const store = new FileSegmentedAdministrativeEventHistory(root);
      expect((await store.verifyIntegrity()).outcome).toBe("verified");
      expect(readdirSync(root)).toHaveLength(0);
      await store.record(event(1));
      writeFileSync(join(root, "unexpected.txt"), "unknown", { mode: 0o600 });
      expect((await store.verifyIntegrity()).outcome).toBe("broken");
      await expect(store.query()).rejects.toMatchObject({
        code: "event_history_corrupted",
      });
    } finally {
      cleanup(root);
    }
  });
});
