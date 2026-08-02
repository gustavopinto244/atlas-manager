import type { BackupRun } from "../domain/backup-run.js";
import type {
  BackupRunQuery,
  BackupRunStore,
  BackupRunStoreSnapshot,
} from "../application/ports/backup-ports.js";

export class InMemoryBackupRunStore implements BackupRunStore {
  readonly #runs = new Map<string, BackupRun>();
  readonly #started = new Map<string, BackupRun>();

  public appendStarted(run: BackupRun): Promise<void> {
    if (
      run.status !== "started" ||
      this.#runs.has(run.runId) ||
      this.#started.has(run.runId)
    )
      throw new Error("backup_run_transition_invalid");
    this.assertSequence(run.sequence);
    this.#started.set(run.runId, run);
    return Promise.resolve();
  }

  public appendTerminal(run: BackupRun): Promise<void> {
    const started = this.#started.get(run.runId);
    if (
      started === undefined ||
      run.status === "started" ||
      this.#runs.has(run.runId) ||
      run.sequence !== started.sequence
    )
      throw new Error("backup_run_transition_invalid");
    this.#started.delete(run.runId);
    this.#runs.set(run.runId, run);
    return Promise.resolve();
  }

  public getByRunId(runId: string): Promise<BackupRun | null> {
    return Promise.resolve(
      this.#runs.get(runId) ?? this.#started.get(runId) ?? null,
    );
  }

  public query(input: BackupRunQuery = {}): Promise<readonly BackupRun[]> {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("backup_query_invalid");
    const runs = [
      ...this.#runs.values(),
      ...[...this.#started.values()].map((run) =>
        Object.freeze({
          ...run,
          status: "interrupted" as const,
          failureCode: "interrupted_run",
        }),
      ),
    ]
      .filter((run) => (input.afterSequence ?? 0) < run.sequence)
      .filter(
        (run) =>
          input.targetId === undefined || run.targetId === input.targetId,
      )
      .filter(
        (run) => input.status === undefined || run.status === input.status,
      )
      .filter(
        (run) => input.trigger === undefined || run.trigger === input.trigger,
      )
      .filter(
        (run) =>
          input.startedFrom === undefined || run.startedAt >= input.startedFrom,
      )
      .filter(
        (run) =>
          input.startedTo === undefined || run.startedAt <= input.startedTo,
      )
      .sort((left, right) => left.sequence - right.sequence);
    return Promise.resolve(Object.freeze(runs.slice(0, limit)));
  }

  public async reconstruct(): Promise<BackupRunStoreSnapshot> {
    return Object.freeze({
      runs: await this.query({ limit: 100 }),
      active: this.#started.size > 0,
      interrupted: Object.freeze(
        [...this.#started.values()].map((run) =>
          Object.freeze({
            ...run,
            status: "interrupted" as const,
            failureCode: "interrupted_run",
          }),
        ),
      ),
    });
  }

  private assertSequence(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      throw new Error("backup_sequence_invalid");
    const all = [...this.#runs.values(), ...this.#started.values()];
    const expected =
      all.length === 0 ? 1 : Math.max(...all.map((run) => run.sequence)) + 1;
    if (sequence !== expected) throw new Error("backup_sequence_conflict");
  }
}
