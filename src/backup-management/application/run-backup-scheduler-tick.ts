import type {
  BackupClock,
  BackupOccurrenceClaimStore,
  BackupSchedulerCursorStore,
  BackupTargetCatalog,
} from "./ports/backup-ports.js";
import type { RunRegisteredBackup } from "./run-registered-backup.js";

export interface BackupOccurrence {
  readonly targetId: string;
  readonly scheduledFor: string;
}

export interface BackupSchedulerTickResult {
  readonly result:
    "idle" | "initialized" | "advanced" | "incomplete" | "conflict" | "blocked";
  readonly processedCount: number;
  readonly duplicateCount: number;
}

export class RunBackupSchedulerTick {
  readonly #catalog: BackupTargetCatalog;
  readonly #cursor: BackupSchedulerCursorStore;
  readonly #claims: BackupOccurrenceClaimStore;
  readonly #run: RunRegisteredBackup;
  readonly #clock: BackupClock;
  #active = false;

  public constructor(input: {
    readonly catalog: BackupTargetCatalog;
    readonly cursor: BackupSchedulerCursorStore;
    readonly claims: BackupOccurrenceClaimStore;
    readonly run: RunRegisteredBackup;
    readonly clock: BackupClock;
  }) {
    this.#catalog = input.catalog;
    this.#cursor = input.cursor;
    this.#claims = input.claims;
    this.#run = input.run;
    this.#clock = input.clock;
    Object.freeze(this);
  }

  public async execute(): Promise<BackupSchedulerTickResult> {
    if (this.#active)
      return Object.freeze({
        result: "conflict",
        processedCount: 0,
        duplicateCount: 0,
      });
    this.#active = true;
    try {
      const now = this.#clock.now();
      const current = now.toISOString();
      const cursor = await this.#cursor.read();
      if (cursor === null) {
        if (!(await this.#cursor.compareAndSet(null, current)))
          return Object.freeze({
            result: "conflict",
            processedCount: 0,
            duplicateCount: 0,
          });
        return Object.freeze({
          result: "initialized",
          processedCount: 0,
          duplicateCount: 0,
        });
      }
      const occurrences = dueOccurrences(
        this.#catalog.list(),
        new Date(cursor),
        now,
      ).slice(0, 32);
      let processedCount = 0;
      let duplicateCount = 0;
      for (const occurrence of occurrences) {
        const claim = await this.#claims.claim(
          occurrence.targetId,
          occurrence.scheduledFor,
        );
        if (claim === "duplicate") {
          duplicateCount += 1;
          continue;
        }
        try {
          await this.#run.execute({
            targetId: occurrence.targetId,
            trigger: "scheduled",
            scheduledFor: occurrence.scheduledFor,
          });
          processedCount += 1;
        } catch {
          return Object.freeze({
            result: "incomplete",
            processedCount,
            duplicateCount,
          });
        }
      }
      if (!(await this.#cursor.compareAndSet(cursor, current)))
        return Object.freeze({
          result: "conflict",
          processedCount,
          duplicateCount,
        });
      return Object.freeze({
        result: occurrences.length === 0 ? "idle" : "advanced",
        processedCount,
        duplicateCount,
      });
    } finally {
      this.#active = false;
    }
  }
}

function dueOccurrences(
  targets: ReturnType<BackupTargetCatalog["list"]>,
  from: Date,
  to: Date,
): BackupOccurrence[] {
  const result: BackupOccurrence[] = [];
  const cursor = new Date(from.getTime() + 1);
  while (cursor <= to && result.length < 32) {
    for (const target of targets) {
      if (
        target.schedule.mode !== "scheduled" ||
        target.schedule.schedule === null
      )
        continue;
      const local = new Intl.DateTimeFormat("en-US", {
        timeZone: target.schedule.timezone ?? "America/Sao_Paulo",
        weekday: "long",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(cursor);
      const values = Object.fromEntries(
        local.map((part) => [part.type, part.value]),
      );
      const weekday = values.weekday?.toLowerCase();
      const hour = values.hour ?? "00";
      const minute = values.minute ?? "00";
      const matching = target.schedule.schedule.windows.find(
        (window) =>
          window.weekday === weekday && window.start === `${hour}:${minute}`,
      );
      if (matching !== undefined)
        result.push(
          Object.freeze({
            targetId: target.id,
            scheduledFor: cursor.toISOString(),
          }),
        );
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return result.sort(
    (left, right) =>
      left.scheduledFor.localeCompare(right.scheduledFor) ||
      left.targetId.localeCompare(right.targetId),
  );
}
