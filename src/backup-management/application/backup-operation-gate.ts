import type { BackupOperationGate } from "./ports/backup-ports.js";

export class FixedBackupOperationGate implements BackupOperationGate {
  #active = false;

  public tryAcquire(): (() => void) | undefined {
    if (this.#active) return undefined;
    this.#active = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active = false;
    };
  }

  public isActive(): boolean {
    return this.#active;
  }
}
