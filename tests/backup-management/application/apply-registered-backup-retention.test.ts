import { describe, expect, it } from "vitest";
import { ApplyRegisteredBackupRetention } from "../../../src/backup-management/application/apply-registered-backup-retention.js";
import { FixedBackupOperationGate } from "../../../src/backup-management/application/backup-operation-gate.js";
import { RunRegisteredBackup } from "../../../src/backup-management/application/run-registered-backup.js";
import { InMemoryBackupRunStore } from "../../../src/backup-management/infrastructure/in-memory-backup-run-store.js";
import { InMemoryBackupTargetCatalog } from "../../../src/backup-management/infrastructure/in-memory-backup-target-catalog.js";
import { MockBackupAdapter } from "../../../src/backup-management/infrastructure/mock-backup-adapter.js";
import { createBackupTarget } from "../../../src/backup-management/domain/backup-target.js";
import type {
  BackupArtifactStore,
  ManagedBackupArtifact,
} from "../../../src/backup-management/application/apply-registered-backup-retention.js";

const target = createBackupTarget({
  id: "retention",
  displayName: "Retention",
  kind: "mock",
  schedule: { mode: "manual" },
  retention: { keepLastSuccessful: 2 },
  limits: {
    maxFiles: 1,
    maxTotalBytes: 100,
    maxFileBytes: 100,
    maxDepth: 2,
    maxRelativePathBytes: 100,
  },
});

class FakeArtifactStore implements BackupArtifactStore {
  public removed: string[] = [];
  public constructor(public readonly artifacts: ManagedBackupArtifact[]) {}
  public listManaged(): Promise<readonly ManagedBackupArtifact[]> {
    return Promise.resolve(this.artifacts);
  }
  public removeManaged(_targetId: string, runId: string): Promise<void> {
    this.removed.push(runId);
    return Promise.resolve();
  }
}

describe("ApplyRegisteredBackupRetention", () => {
  it("paginates all successful runs and preserves the recent minimum", async () => {
    const runs = new InMemoryBackupRunStore();
    const runner = new RunRegisteredBackup({
      catalog: InMemoryBackupTargetCatalog.create([target]),
      runStore: runs,
      gate: new FixedBackupOperationGate(),
      clock: { now: () => new Date("2026-08-02T12:00:00.000Z") },
      adapters: {
        mock: new MockBackupAdapter(),
        filesystem_tree: new MockBackupAdapter(),
      },
    });
    for (let index = 0; index < 102; index += 1)
      await runner.execute({ targetId: target.id, trigger: "manual" });
    const successful = await runs.query({ targetId: target.id, limit: 100 });
    const all: ManagedBackupArtifact[] = [];
    for (let after = 0; ;) {
      const page = await runs.query({
        targetId: target.id,
        status: "succeeded",
        afterSequence: after,
        limit: 100,
      });
      all.push(
        ...page.map((run) => ({
          targetId: target.id,
          runId: run.runId,
          completedAt: run.completedAt!,
          manifestSha256: run.artifact!.manifestSha256,
        })),
      );
      if (page.length < 100) break;
      after = page.at(-1)!.sequence;
    }
    expect(successful).toHaveLength(100);
    const artifacts = new FakeArtifactStore(all);
    const result = await new ApplyRegisteredBackupRetention({
      catalog: InMemoryBackupTargetCatalog.create([target]),
      runs,
      artifacts,
      gate: new FixedBackupOperationGate(),
      clock: { now: () => new Date("2026-08-02T12:00:00.000Z") },
    }).execute(target.id);
    expect(result.result).toBe("completed");
    expect(result.deletedCount).toBe(100);
    expect(artifacts.removed).not.toContain(all.at(-1)!.runId);
    expect(artifacts.removed).not.toContain(all.at(-2)!.runId);
  });
});
