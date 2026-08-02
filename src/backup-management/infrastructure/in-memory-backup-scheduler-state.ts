import type {
  BackupOccurrenceClaimStore,
  BackupSchedulerCursorStore,
} from "../application/ports/backup-ports.js";

export class InMemoryBackupOccurrenceClaimStore implements BackupOccurrenceClaimStore {
  readonly #claims = new Set<string>();
  public claim(
    targetId: string,
    scheduledFor: string,
  ): Promise<"claimed" | "duplicate"> {
    const value = `${targetId}\n${scheduledFor}`;
    if (this.#claims.has(value)) return Promise.resolve("duplicate");
    this.#claims.add(value);
    return Promise.resolve("claimed");
  }
}

export class InMemoryBackupSchedulerCursorStore implements BackupSchedulerCursorStore {
  #value: string | null = null;
  public read(): Promise<string | null> {
    return Promise.resolve(this.#value);
  }
  public compareAndSet(
    expected: string | null,
    next: string,
  ): Promise<boolean> {
    if (this.#value !== expected) return Promise.resolve(false);
    this.#value = next;
    return Promise.resolve(true);
  }
}
