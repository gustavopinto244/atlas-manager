import type {
  BackupAdapter,
  BackupArtifactResult,
} from "../application/ports/backup-ports.js";

export type MockBackupOutcome =
  | "success"
  | "source_unavailable"
  | "capacity_failure"
  | "copy_failure"
  | "manifest_failure"
  | "publication_failure";

export class MockBackupAdapter implements BackupAdapter {
  public readonly calls: string[] = [];
  public outcome: MockBackupOutcome = "success";
  public delayMs = 0;

  public async run(input: {
    readonly target: { readonly id: string };
    readonly runId: string;
    readonly startedAt: string;
  }): Promise<BackupArtifactResult> {
    this.calls.push(input.target.id);
    if (this.delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.outcome !== "success") throw new Error(`backup_${this.outcome}`);
    return Object.freeze({
      fileCount: 0,
      totalBytes: 0,
      manifestSha256: "1".repeat(64),
      artifactDirectory: `mock://${input.target.id}/${input.runId}`,
    });
  }
}
