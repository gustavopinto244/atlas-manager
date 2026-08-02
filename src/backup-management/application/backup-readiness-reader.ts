import type {
  BackupReadiness,
  BackupReadinessReader,
  BackupRunStore,
  BackupOperationGate,
} from "./ports/backup-ports.js";

export class ProjectBackupReadinessReader implements BackupReadinessReader {
  readonly #store: BackupRunStore;
  readonly #gate: BackupOperationGate;

  public constructor(store: BackupRunStore, gate: BackupOperationGate) {
    this.#store = store;
    this.#gate = gate;
  }

  public async read(): Promise<BackupReadiness> {
    if (this.#gate.isActive()) return Object.freeze({ state: "active" });
    try {
      const snapshot = await this.#store.reconstruct();
      if (snapshot.interrupted.length > 0)
        return Object.freeze({ state: "interrupted" });
      return Object.freeze({ state: "ready" });
    } catch {
      return Object.freeze({ state: "unavailable" });
    }
  }
}
