import type { BackupTargetCatalog } from "../application/ports/backup-ports.js";
import type { BackupTarget } from "../domain/backup-target.js";

export class BackupTargetCatalogValidationError extends Error {
  public override readonly name = "BackupTargetCatalogValidationError";
  public constructor(
    public readonly code: "duplicate_id" | "duplicate_source",
  ) {
    super(`Invalid backup target catalog: ${code}`);
  }
}

export class InMemoryBackupTargetCatalog implements BackupTargetCatalog {
  readonly #targets: readonly BackupTarget[];
  readonly #byId: ReadonlyMap<string, BackupTarget>;

  protected constructor(targets: readonly BackupTarget[]) {
    this.#targets = Object.freeze(
      [...targets].sort((left, right) => left.id.localeCompare(right.id)),
    );
    this.#byId = new Map(this.#targets.map((target) => [target.id, target]));
    Object.freeze(this);
  }

  public static create(
    targets: readonly BackupTarget[],
  ): InMemoryBackupTargetCatalog {
    const ids = new Set<string>();
    const sources = new Set<string>();
    for (const target of targets) {
      if (ids.has(target.id))
        throw new BackupTargetCatalogValidationError("duplicate_id");
      ids.add(target.id);
      if (target.sourcePath !== null) {
        if (sources.has(target.sourcePath))
          throw new BackupTargetCatalogValidationError("duplicate_source");
        sources.add(target.sourcePath);
      }
    }
    return new InMemoryBackupTargetCatalog(targets);
  }

  public list(): readonly BackupTarget[] {
    return this.#targets;
  }

  public findById(id: string): BackupTarget | null {
    return this.#byId.get(id) ?? null;
  }
}
