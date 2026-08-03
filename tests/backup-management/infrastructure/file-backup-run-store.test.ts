import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileBackupRunStore } from "../../../src/backup-management/infrastructure/file-backup-run-store.js";
import { createBackupTarget } from "../../../src/backup-management/domain/backup-target.js";
import {
  completeBackupRun,
  createStartedBackupRun,
} from "../../../src/backup-management/domain/backup-run.js";

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

  it("fails closed when history changes after a successful reconstruction", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-run-store-invalidated-"));
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
      const store = new FileBackupRunStore(path);
      await store.reconstruct();
      await writeFile(path, '{"kind":"started"}\n', { mode: 0o600 });
      await expect(store.getByRunId(run.runId)).rejects.toThrow(
        "backup_run_history_corrupt",
      );
      await expect(store.query()).rejects.toThrow("backup_run_history_corrupt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconstructs a valid append from another process-style store", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-run-store-process-"));
    try {
      const path = join(root, "runs.jsonl");
      const first = createStartedBackupRun({
        sequence: 1,
        runId: "6f5d6f49-6d3b-4f73-8f07-0f1b5ec9d1b2",
        target,
        trigger: "manual",
        requestedAt: "2026-08-02T12:00:00.000Z",
        startedAt: "2026-08-02T12:00:00.000Z",
      });
      const second = createStartedBackupRun({
        sequence: 2,
        runId: "7f5d6f49-6d3b-4f73-8f07-0f1b5ec9d1b2",
        target,
        trigger: "scheduled",
        scheduledFor: "2026-08-02T12:05:00.000Z",
        requestedAt: "2026-08-02T12:05:00.000Z",
        startedAt: "2026-08-02T12:05:00.000Z",
      });
      const firstStore = new FileBackupRunStore(path);
      await firstStore.appendStarted(first);
      await firstStore.reconstruct();
      await new FileBackupRunStore(path).appendStarted(second);
      const runs = await firstStore.query({ limit: 100 });
      expect(runs.map((run) => run.sequence)).toEqual([1, 2]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates transitions before persisting terminal records", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-run-store-transition-"));
    try {
      const path = join(root, "runs.jsonl");
      const started = createStartedBackupRun({
        sequence: 1,
        runId: "6f5d6f49-6d3b-4f73-8f07-0f1b5ec9d1b2",
        target,
        trigger: "manual",
        requestedAt: "2026-08-02T12:00:00.000Z",
        startedAt: "2026-08-02T12:00:00.000Z",
      });
      const terminal = completeBackupRun(
        started,
        { status: "failed", failureCode: "copy_failed" },
        "2026-08-02T12:01:00.000Z",
      );
      const store = new FileBackupRunStore(path);
      await store.appendStarted(started);
      await store.appendTerminal(terminal);
      await expect(store.appendTerminal(terminal)).rejects.toThrow(
        "backup_run_transition_invalid",
      );
      const persisted = await readFile(path, "utf8");
      expect(persisted).toHaveLength(
        `${JSON.stringify({ kind: "started", run: started })}\n${JSON.stringify({ kind: "terminal", run: terminal })}\n`
          .length,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allocates file-backed sequences beyond the query page size", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-run-store-sequence-"));
    try {
      const store = new FileBackupRunStore(join(root, "runs.jsonl"));
      for (let sequence = 1; sequence <= 102; sequence += 1) {
        await store.appendStarted(
          createStartedBackupRun({
            sequence,
            runId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
            target,
            trigger: "manual",
            requestedAt: "2026-08-02T12:00:00.000Z",
            startedAt: "2026-08-02T12:00:00.000Z",
          }),
        );
      }
      await expect(store.allocateNextSequence()).resolves.toBe(103);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
