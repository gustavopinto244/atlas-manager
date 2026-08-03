import { describe, expect, it } from "vitest";
import { FixedBackupOperationGate } from "../../../src/backup-management/application/backup-operation-gate.js";
import { RunRegisteredBackup } from "../../../src/backup-management/application/run-registered-backup.js";
import { InMemoryBackupRunStore } from "../../../src/backup-management/infrastructure/in-memory-backup-run-store.js";
import { InMemoryBackupTargetCatalog } from "../../../src/backup-management/infrastructure/in-memory-backup-target-catalog.js";
import { MockBackupAdapter } from "../../../src/backup-management/infrastructure/mock-backup-adapter.js";
import { createBackupTarget } from "../../../src/backup-management/domain/backup-target.js";

const target = createBackupTarget({
  id: "example-backup",
  displayName: "Example backup",
  kind: "mock",
  schedule: { mode: "manual" },
  retention: { keepLastSuccessful: 1 },
  limits: {
    maxFiles: 10,
    maxTotalBytes: 1024,
    maxFileBytes: 512,
    maxDepth: 4,
    maxRelativePathBytes: 128,
  },
});

describe("RunRegisteredBackup", () => {
  it("persists started and successful terminal records through the mock adapter", async () => {
    const store = new InMemoryBackupRunStore();
    const adapter = new MockBackupAdapter();
    const run = new RunRegisteredBackup({
      catalog: InMemoryBackupTargetCatalog.create([target]),
      runStore: store,
      gate: new FixedBackupOperationGate(),
      clock: { now: () => new Date("2026-08-02T12:00:00.000Z") },
      adapters: { mock: adapter, filesystem_tree: adapter },
    });
    const result = await run.execute({
      targetId: target.id,
      trigger: "manual",
    });
    expect(result.run.status).toBe("succeeded");
    expect(result.run.artifact?.manifestSha256).toHaveLength(64);
    expect(adapter.calls).toEqual([target.id]);
    expect((await store.reconstruct()).runs).toHaveLength(1);
  });

  it("fails fast when the shared operation gate is busy", async () => {
    const gate = new FixedBackupOperationGate();
    const release = gate.tryAcquire();
    const adapter = new MockBackupAdapter();
    const run = new RunRegisteredBackup({
      catalog: InMemoryBackupTargetCatalog.create([target]),
      runStore: new InMemoryBackupRunStore(),
      gate,
      clock: { now: () => new Date("2026-08-02T12:00:00.000Z") },
      adapters: { mock: adapter, filesystem_tree: adapter },
    });
    await expect(
      run.execute({ targetId: target.id, trigger: "manual" }),
    ).rejects.toThrow("backup_operation_busy");
    expect(adapter.calls).toEqual([]);
    release?.();
  });

  it("allocates numeric sequences beyond the first page", async () => {
    const store = new InMemoryBackupRunStore();
    const adapter = new MockBackupAdapter();
    const run = new RunRegisteredBackup({
      catalog: InMemoryBackupTargetCatalog.create([target]),
      runStore: store,
      gate: new FixedBackupOperationGate(),
      clock: { now: () => new Date("2026-08-02T12:00:00.000Z") },
      adapters: { mock: adapter, filesystem_tree: adapter },
    });
    for (let index = 0; index < 102; index += 1)
      await run.execute({ targetId: target.id, trigger: "manual" });
    const runs = await store.query({ afterSequence: 98, limit: 10 });
    expect(runs.map((value) => value.sequence)).toEqual([99, 100, 101, 102]);
  });
});
