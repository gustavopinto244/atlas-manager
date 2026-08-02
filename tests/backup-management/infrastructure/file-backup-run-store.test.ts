import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileBackupRunStore } from "../../../src/backup-management/infrastructure/file-backup-run-store.js";
import { createBackupTarget } from "../../../src/backup-management/domain/backup-target.js";
import { createStartedBackupRun } from "../../../src/backup-management/domain/backup-run.js";

const target = createBackupTarget({
  id: "backup",
  displayName: "Backup",
  kind: "mock",
  schedule: { mode: "manual" },
  retention: { keepLastSuccessful: 1 },
  limits: {
    maxFiles: 1,
    maxTotalBytes: 100,
    maxFileBytes: 100,
    maxDepth: 2,
    maxRelativePathBytes: 100,
  },
});

describe("FileBackupRunStore", () => {
  it("reconstructs a started run as interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-run-store-"));
    try {
      const path = join(root, "runs.jsonl");
      const run = createStartedBackupRun({
        sequence: 1,
        runId: "6f5d6f49-6d3b-4f73-8f07-0f1b5ec9d1b2",
        target,
        trigger: "manual",
        requestedAt: "2026-08-02T12:00:00.000Z",
        startedAt: "2026-08-02T12:00:00.000Z",
      });
      await new FileBackupRunStore(path).appendStarted(run);
      const snapshot = await new FileBackupRunStore(path).reconstruct();
      expect(snapshot.interrupted[0]?.status).toBe("interrupted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate JSON fields and malformed persisted entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-run-corrupt-"));
    try {
      const path = join(root, "runs.jsonl");
      await writeFile(path, '{"kind":"started","kind":"terminal","run":{}}\n', {
        mode: 0o600,
      });
      await expect(
        new FileBackupRunStore(path).reconstruct(),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
