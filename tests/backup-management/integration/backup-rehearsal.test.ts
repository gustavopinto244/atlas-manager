import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackupManagement } from "../../../src/backup-management/composition/create-backup-management.js";
import { createBackupTarget } from "../../../src/backup-management/domain/backup-target.js";
import { MockBackupAdapter } from "../../../src/backup-management/infrastructure/mock-backup-adapter.js";
import { createBackupRehearsalEvidence } from "../../../src/backup-management/application/backup-rehearsal-evidence.js";

const sandboxes: string[] = [];

afterEach(async () => {
  for (const sandbox of sandboxes.splice(0))
    await rm(sandbox, { recursive: true, force: true });
});

function limits() {
  return {
    maxFiles: 100,
    maxTotalBytes: 1024 * 1024,
    maxFileBytes: 1024 * 1024,
    maxDepth: 8,
    maxRelativePathBytes: 256,
  };
}

describe("controlled backup orchestration rehearsal", () => {
  it("runs a filesystem backup, publishes a manifest, and applies retention", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "atlas-backup-rehearsal-"));
    sandboxes.push(sandbox);
    const source = join(sandbox, "source");
    const destination = join(sandbox, "backups");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(source, "nested"), { recursive: true });
    await writeFile(join(source, "nested", "value.txt"), "deterministic\n");
    const target = createBackupTarget({
      id: "local-tree",
      displayName: "Local tree",
      kind: "filesystem_tree",
      sourcePath: source,
      schedule: { mode: "manual" },
      retention: { keepLastSuccessful: 1 },
      limits: limits(),
    });
    const management = createBackupManagement({
      targets: [target],
      destinationRoot: destination,
    });

    const first = await management.runRegisteredBackup({
      targetId: target.id,
      trigger: "manual",
    });
    const second = await management.runRegisteredBackup({
      targetId: target.id,
      trigger: "manual",
    });
    expect(first.run.status).toBe("succeeded");
    expect(second.run.status).toBe("succeeded");
    expect(first.artifactDirectory).not.toBeNull();
    const manifest = await readFile(
      join(first.artifactDirectory!, "MANIFEST.json"),
      "utf8",
    );
    expect(manifest).not.toContain(source);
    const parsedManifest = JSON.parse(manifest) as {
      readonly files: readonly { readonly sha256: string }[];
    };
    expect(parsedManifest.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(createHash("sha256").update(manifest).digest("hex")).toBe(
      first.run.artifact?.manifestSha256,
    );

    const retention = await management.pruneBackupRetention(target.id);
    expect(retention.result).toBe("completed");
    expect(retention.deletedCount).toBe(1);
    management.setBackupRetention(target.id, { keepLastSuccessful: 2 });
    const reconstructed = createBackupManagement({
      targets: [target],
      destinationRoot: destination,
    });
    expect(reconstructed.getBackupRetention(target.id).keepLastSuccessful).toBe(
      2,
    );
    expect(
      (
        await management.getBackupRuns({ targetId: target.id, limit: 100 })
      ).filter((run) => run.status === "succeeded"),
    ).toHaveLength(2);
    expect((await management.readiness.read()).state).toBe("ready");
  });

  it("claims a scheduled occurrence once and keeps backup readiness bounded", async () => {
    let now = new Date("2024-01-01T05:00:00.000Z");
    const adapter = new MockBackupAdapter();
    const target = createBackupTarget({
      id: "scheduled-mock",
      displayName: "Scheduled mock",
      kind: "mock",
      schedule: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "02:01", end: "02:02" }],
      },
      retention: { keepLastSuccessful: 1 },
      limits: limits(),
    });
    const management = createBackupManagement({
      targets: [target],
      clock: { now: () => now },
      adapters: { mock: adapter },
    });

    expect((await management.runBackupSchedulerTick()).result).toBe(
      "initialized",
    );
    now = new Date("2024-01-01T05:02:00.000Z");
    expect((await management.runBackupSchedulerTick()).processedCount).toBe(1);
    expect((await management.runBackupSchedulerTick()).duplicateCount).toBe(0);
    expect(adapter.calls).toEqual([target.id]);
    expect((await management.getBackupRuns({ limit: 100 }))[0]?.trigger).toBe(
      "scheduled",
    );
    expect((await management.readiness.read()).state).toBe("ready");
  });

  it("creates bounded deterministic evidence without private backup data", () => {
    const input = {
      baselineCommit: "2722e7d043a3e819cdbe772020b5008cc14e6428",
      bundleSha256: "a".repeat(64),
      targetScenarios: ["mock"],
      manualRunScenarios: ["succeeded"],
      schedulerScenarios: ["duplicate_prevented"],
      retentionScenarios: ["minimum_preserved"],
      authorizationScenarios: ["backup_operator_allowed"],
      shutdownReadinessScenarios: ["active_blocks"],
      steps: [
        {
          sequence: 1,
          action: "manual_backup",
          expectedResult: "succeeded",
          observedResult: "succeeded",
          reportSha256: "b".repeat(64),
          mutationClassification: "backup_artifact",
        },
      ],
      finalState: "ready",
    } as const;
    const first = createBackupRehearsalEvidence(input);
    const second = createBackupRehearsalEvidence(input);
    expect(first.json).toBe(second.json);
    expect(first.sha256).toBe(second.sha256);
    expect(first.json).not.toContain("/tmp/");
    expect(first.json).not.toContain("sourcePath");
  });
});
