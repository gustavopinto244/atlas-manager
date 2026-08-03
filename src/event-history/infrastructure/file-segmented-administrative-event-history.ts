import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isCanonicalTimestamp } from "../../power-management/domain/canonical-timestamp.js";
import {
  createAdministrativeEvent,
  createAdministrativeEventInput,
  type AdministrativeEvent,
  type AdministrativeEventInput,
} from "../domain/administrative-event.js";
import {
  createAdministrativeEventHistoryPage,
  type AdministrativeEventHistoryPage,
} from "../domain/administrative-event-history-page.js";
import {
  createAdministrativeEventHistoryQuery,
  type AdministrativeEventHistoryQuery,
} from "../domain/administrative-event-history-query.js";
import type { AdministrativeEventRecorder } from "../application/ports/administrative-event-recorder.js";
import type {
  AdministrativeEventHistoryReadinessReader,
  AdministrativeEventHistoryReadinessResult,
  AdministrativeEventHistoryReader,
} from "../application/ports/administrative-event-history-reader.js";
import type {
  AdministrativeEventHistoryOperations,
  EventHistoryExportRequest,
  EventHistoryExportResult,
  EventHistoryIntegrityResult,
  EventHistoryRetentionResult,
  EventHistoryRetentionSummary,
} from "../application/ports/administrative-event-history-operations.js";
import {
  canonicalJson,
  createNextEventHistoryRecord,
  createRetentionPolicy,
  createSegmentManifest,
  DEFAULT_EVENT_HISTORY_RETENTION_POLICY,
  EVENT_HISTORY_GENESIS_SHA256,
  EVENT_HISTORY_MAX_EXPORT_BYTES,
  EVENT_HISTORY_MAX_EXPORT_EVENTS,
  EVENT_HISTORY_MAX_RECORD_BYTES,
  parseEventHistoryRecordLine,
  parseRetentionAnchor,
  parseSegmentManifest,
  serializeEventHistoryRecord,
  sha256,
  type EventHistoryExportMetadata,
  type EventHistoryRecord,
  type EventHistoryRetentionPolicy,
  type EventHistorySegmentManifest,
} from "../domain/event-history-record.js";
import { parseStrictJson } from "../../config/strict-json.js";
import {
  FileEventHistoryWriterLock,
  FileEventHistoryWriterLockError,
} from "./file-event-history-writer-lock.js";

export const EVENT_HISTORY_ACTIVE_SEGMENT_MAX_EVENTS = 10_000;
export const EVENT_HISTORY_ACTIVE_SEGMENT_MAX_BYTES = 16 * 1024 * 1024;

export type SegmentedEventHistoryErrorCode =
  | "event_history_path_invalid"
  | "event_history_parent_invalid"
  | "event_history_file_invalid"
  | "event_history_permissions_unsafe"
  | "event_history_corrupted"
  | "event_history_interrupted"
  | "event_history_writer_busy"
  | "event_history_writer_stale"
  | "event_history_writer_invalid"
  | "event_history_capacity_exceeded"
  | "event_history_history_pruned"
  | "event_history_export_not_found"
  | "event_history_export_corrupt"
  | "event_history_retention_blocked"
  | "event_history_recovery_required";

export class SegmentedEventHistoryError extends Error {
  public override readonly name = "SegmentedEventHistoryError";
  public constructor(public readonly code: SegmentedEventHistoryErrorCode) {
    super(`Segmented event history failed: ${code}`);
    Object.freeze(this);
  }
}

export interface FileSegmentedAdministrativeEventHistoryDependencies {
  readonly currentUserId?: () => number;
  readonly clock?: () => string;
  readonly lockPath?: string;
  readonly maxSegmentEvents?: number;
  readonly maxSegmentBytes?: number;
  readonly retentionPolicy?: unknown;
}

type Reconstruction = Readonly<{
  events: readonly AdministrativeEvent[];
  records: readonly EventHistoryRecord[];
  sealed: readonly Readonly<{
    name: string;
    manifest: EventHistorySegmentManifest;
    bytes: Buffer;
  }>[];
  activeBytes: Buffer;
  activeRecords: readonly EventHistoryRecord[];
  earliestRetainedSequence: number;
  latestSequence: number;
  lastRecordSha256: string;
  lastSegmentSha256: string;
  retentionAnchorPresent: boolean;
}>;

export class FileSegmentedAdministrativeEventHistory
  implements
    AdministrativeEventRecorder,
    AdministrativeEventHistoryReader,
    AdministrativeEventHistoryReadinessReader,
    AdministrativeEventHistoryOperations
{
  readonly #root: string;
  readonly #lockPath: string;
  readonly #currentUserId: () => number;
  readonly #clock: () => string;
  readonly #maxSegmentEvents: number;
  readonly #maxSegmentBytes: number;
  readonly #initialRetentionPolicy: EventHistoryRetentionPolicy | undefined;
  readonly #writerLock: FileEventHistoryWriterLock;
  #tail: Promise<void> = Promise.resolve();

  public constructor(
    root: string,
    dependencies: FileSegmentedAdministrativeEventHistoryDependencies = {},
  ) {
    validateConfiguredPath(root);
    this.#root = root;
    this.#lockPath =
      dependencies.lockPath ??
      join(dirname(root), `.${basename(root)}-writer.lock`);
    validateConfiguredPath(this.#lockPath);
    this.#currentUserId = dependencies.currentUserId ?? defaultCurrentUserId;
    this.#clock = dependencies.clock ?? (() => new Date().toISOString());
    this.#maxSegmentEvents = validateLimit(
      dependencies.maxSegmentEvents ?? EVENT_HISTORY_ACTIVE_SEGMENT_MAX_EVENTS,
      100,
      100_000,
    );
    this.#maxSegmentBytes = validateLimit(
      dependencies.maxSegmentBytes ?? EVENT_HISTORY_ACTIVE_SEGMENT_MAX_BYTES,
      1 * 1024 * 1024,
      64 * 1024 * 1024,
    );
    this.#initialRetentionPolicy =
      dependencies.retentionPolicy === undefined
        ? undefined
        : createRetentionPolicy(dependencies.retentionPolicy);
    this.#writerLock = new FileEventHistoryWriterLock(this.#lockPath, {
      currentUserId: this.#currentUserId,
      clock: this.#clock,
    });
  }

  public record(input: AdministrativeEventInput): Promise<AdministrativeEvent> {
    const validated = createAdministrativeEventInput(input);
    return this.#serialize(() => this.#recordOne(validated));
  }

  public query(input?: unknown): Promise<AdministrativeEventHistoryPage> {
    const query = createAdministrativeEventHistoryQuery(input);
    return this.#serialize(() => this.#queryOne(query));
  }

  public check(): Promise<AdministrativeEventHistoryReadinessResult> {
    return this.#serialize(() => {
      try {
        this.#reconstruct();
        return Object.freeze({ outcome: "ready" as const });
      } catch (error) {
        return Object.freeze({
          outcome: "unavailable" as const,
          code:
            error instanceof SegmentedEventHistoryError &&
            (error.code === "event_history_corrupted" ||
              error.code === "event_history_interrupted")
              ? ("event_history_corrupted" as const)
              : ("event_history_unavailable" as const),
        });
      }
    });
  }

  public verifyIntegrity(): Promise<EventHistoryIntegrityResult> {
    return this.#serialize(() => {
      const verifiedAt = this.#clock();
      try {
        const state = this.#reconstruct();
        return Object.freeze({
          outcome: state.retentionAnchorPresent
            ? ("verified_with_retention" as const)
            : ("verified" as const),
          earliestRetainedSequence: state.earliestRetainedSequence,
          latestSequence: state.latestSequence,
          sealedSegmentCount: state.sealed.length,
          activeSegmentEventCount: state.activeRecords.length,
          retainedEventCount: state.events.length,
          retentionAnchorPresent: state.retentionAnchorPresent,
          lastRecordSha256: state.lastRecordSha256,
          lastSegmentSha256: state.lastSegmentSha256,
          verifiedAt,
        });
      } catch (error) {
        const code =
          error instanceof SegmentedEventHistoryError
            ? error.code
            : "event_history_corrupted";
        return Object.freeze({
          outcome:
            code === "event_history_interrupted"
              ? ("interrupted" as const)
              : ("broken" as const),
          verifiedAt,
        });
      }
    });
  }

  public rotate(): Promise<
    Readonly<{ outcome: "rotated" | "unchanged" | "recovery_required" }>
  > {
    return this.#serialize(() => this.#withWriterLock(() => this.#rotateOne()));
  }

  public getRetentionPolicy(): Promise<EventHistoryRetentionPolicy> {
    return this.#serialize(() => this.#readPolicy());
  }

  public setRetentionPolicy(
    policy: unknown,
  ): Promise<EventHistoryRetentionPolicy> {
    return this.#serialize(() =>
      this.#withWriterLock(() => {
        const validated = createRetentionPolicy(policy);
        ensureRoot(this.#root, this.#currentUserId());
        atomicWrite(
          join(this.#root, "retention-policy.json"),
          `${canonicalJson(validated)}\n`,
          0o600,
        );
        return validated;
      }),
    );
  }

  public getRetentionSummary(): Promise<EventHistoryRetentionSummary> {
    return this.#serialize(() => {
      const state = this.#reconstruct();
      const policy = this.#readPolicy();
      const eligible = Math.max(
        0,
        state.sealed.length - policy.segments.minSealedSegments,
      );
      const exports = this.#listExportsUnsafe();
      return Object.freeze({
        policy,
        earliestRetainedSequence: state.earliestRetainedSequence,
        latestSequence: state.latestSequence,
        sealedSegmentCount: state.sealed.length,
        retainedEventCount: state.events.length,
        eligibleSegmentCount: eligible,
        exportCount: exports.length,
        eligibleExportCount: Math.max(
          0,
          exports.length - policy.exports.minExports,
        ),
        automaticPruneEnabled: policy.automaticPruneEnabled,
      });
    });
  }

  public pruneSegments(): Promise<EventHistoryRetentionResult> {
    return this.#serialize(() =>
      this.#withWriterLock(() => this.#pruneSegmentsOne()),
    );
  }

  public listExports(): Promise<readonly EventHistoryExportMetadata[]> {
    return this.#serialize(() => this.#listExportsUnsafe());
  }

  public createExport(input: unknown): Promise<EventHistoryExportResult> {
    return this.#serialize(() =>
      this.#withWriterLock(() => this.#createExportOne(input)),
    );
  }

  public getExport(
    exportId: string,
  ): Promise<EventHistoryExportMetadata | undefined> {
    return this.#serialize(() => this.#getExportUnsafe(exportId));
  }

  public readExport(exportId: string): Promise<Buffer> {
    return this.#serialize(() => {
      const metadata = this.#getExportUnsafe(exportId);
      if (metadata === undefined)
        throw new SegmentedEventHistoryError("event_history_export_not_found");
      return this.#readVerifiedExportContent(exportId, metadata);
    });
  }

  public pruneExports(): Promise<
    Readonly<{
      outcome: "unchanged" | "pruned" | "blocked";
      removedExportCount: number;
    }>
  > {
    return this.#serialize(() =>
      this.#withWriterLock(() => {
        const policy = this.#readPolicy();
        const exports = this.#listExportsUnsafe();
        const now = Date.parse(this.#clock());
        const ageCutoff =
          now - policy.exports.maxExportAgeDays * 24 * 60 * 60 * 1000;
        const candidates = exports.filter((item, index) => {
          if (exports.length - index <= policy.exports.minExports) return false;
          return (
            exports.length - index > policy.exports.maxExports ||
            Date.parse(item.createdAt) < ageCutoff
          );
        });
        let removed = 0;
        for (const metadata of candidates) {
          rmSync(join(this.#exportsPath(), `${metadata.exportId}.jsonl`));
          rmSync(
            join(this.#exportsPath(), `${metadata.exportId}.manifest.json`),
          );
          removed += 1;
        }
        return Object.freeze({
          outcome: removed === 0 ? ("unchanged" as const) : ("pruned" as const),
          removedExportCount: removed,
        });
      }),
    );
  }

  #serialize<T>(operation: () => T): Promise<T> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  #recordOne(input: AdministrativeEventInput): AdministrativeEvent {
    ensureRoot(this.#root, this.#currentUserId());
    return this.#withWriterLock(() => {
      let state = this.#reconstruct();
      const appendRecord = (eventInput: AdministrativeEventInput) => {
        const event = createAdministrativeEvent({
          sequence: state.latestSequence + 1,
          ...eventInput,
        });
        const record = createNextEventHistoryRecord(
          event,
          state.lastRecordSha256,
        );
        const line = serializeEventHistoryRecord(record);
        if (Buffer.byteLength(line) > EVENT_HISTORY_MAX_RECORD_BYTES)
          throw new SegmentedEventHistoryError(
            "event_history_capacity_exceeded",
          );
        if (
          state.activeRecords.length > 0 &&
          (state.activeRecords.length >= this.#maxSegmentEvents ||
            state.activeBytes.byteLength + Buffer.byteLength(line) >
              this.#maxSegmentBytes)
        ) {
          this.#rotateOne();
          state = this.#reconstruct();
        }
        appendFileSync(this.#activePath(), line, { mode: 0o600 });
        chmodSync(this.#activePath(), 0o600);
        syncFile(this.#activePath());
        state = this.#reconstruct();
        return event;
      };

      const recoveryReceipt = join(
        this.#root,
        "stale-lock-recovery-receipt.json",
      );
      if (existsSync(recoveryReceipt)) {
        validateStaleLockRecoveryReceipt(
          recoveryReceipt,
          this.#currentUserId(),
        );
        appendRecord({
          attemptId: randomUUID(),
          occurredAt: this.#clock(),
          source: { kind: "system", actorId: "atlas-manager" },
          target: { kind: "machine", id: "atlas" },
          operation: "recover_administrative_event_history_stale_lock",
          status: "succeeded",
          details: { outcome: "recovered" },
        });
        rmSync(recoveryReceipt, { force: false });
      }

      return appendRecord(input);
    });
  }

  #queryOne(
    query: AdministrativeEventHistoryQuery,
  ): AdministrativeEventHistoryPage {
    const state = this.#reconstruct();
    if (
      query.afterSequence > 0 &&
      query.afterSequence < state.earliestRetainedSequence - 1
    )
      throw new SegmentedEventHistoryError("event_history_history_pruned");
    const matches = state.events.filter((event) => matchesQuery(event, query));
    return createAdministrativeEventHistoryPage({
      events: matches.slice(0, query.limit),
      hasMore: matches.length > query.limit,
    });
  }

  #rotateOne(): Readonly<{
    outcome: "rotated" | "unchanged" | "recovery_required";
  }> {
    const state = this.#reconstruct();
    if (state.activeRecords.length === 0)
      return Object.freeze({ outcome: "unchanged" as const });
    ensureRoot(this.#root, this.#currentUserId());
    const first = state.activeRecords[0]!.sequence;
    const last = state.activeRecords[state.activeRecords.length - 1]!.sequence;
    const segmentName = segmentFileName(first, last);
    const candidate = join(this.#segmentsPath(), `${segmentName}.candidate`);
    const finalSegment = join(this.#segmentsPath(), segmentName);
    const finalManifest = join(
      this.#segmentsPath(),
      `${segmentName}.manifest.json`,
    );
    atomicWrite(
      join(this.#root, "transaction.json"),
      `${canonicalJson({ schemaVersion: 1, operation: "rotation", firstSequence: first, lastSequence: last })}\n`,
      0o600,
    );
    try {
      renameSync(this.#activePath(), candidate);
      chmodSync(candidate, 0o400);
      const bytes = readSafeFile(candidate, this.#currentUserId(), 0o400);
      const manifest = createSegmentManifest({
        schemaVersion: 1,
        firstSequence: first,
        lastSequence: last,
        eventCount: state.activeRecords.length,
        byteCount: bytes.byteLength,
        firstRecordSha256: state.activeRecords[0]!.recordSha256,
        lastRecordSha256:
          state.activeRecords[state.activeRecords.length - 1]!.recordSha256,
        previousSegmentSha256: state.lastSegmentSha256,
        segmentContentSha256: sha256(bytes),
        sealedAt: this.#clock(),
      });
      renameSync(candidate, finalSegment);
      chmodSync(finalSegment, 0o400);
      atomicWrite(
        `${finalManifest}.candidate`,
        `${canonicalJson(manifest)}\n`,
        0o400,
      );
      renameSync(`${finalManifest}.candidate`, finalManifest);
      chmodSync(finalManifest, 0o400);
      atomicWrite(this.#activePath(), "", 0o600);
      rmSync(join(this.#root, "transaction.json"));
      return Object.freeze({ outcome: "rotated" as const });
    } catch {
      throw new SegmentedEventHistoryError("event_history_recovery_required");
    }
  }

  #pruneSegmentsOne(): EventHistoryRetentionResult {
    const state = this.#reconstruct();
    const policy = this.#readPolicy();
    const now = Date.parse(this.#clock());
    const ageCutoff =
      now - policy.segments.maxSealedSegmentAgeDays * 24 * 60 * 60 * 1000;
    const remove: Array<(typeof state.sealed)[number]> = [];
    for (const item of state.sealed) {
      if (
        state.sealed.length - remove.length <=
        policy.segments.minSealedSegments
      )
        break;
      const overCount =
        state.sealed.length - remove.length > policy.segments.maxSealedSegments;
      const tooOld = Date.parse(item.manifest.sealedAt) < ageCutoff;
      if (!overCount && !tooOld) break;
      remove.push(item);
    }
    if (remove.length === 0)
      return Object.freeze({
        outcome: "unchanged" as const,
        removedSegmentCount: 0,
        removedEventCount: 0,
      });
    const last = remove[remove.length - 1]!;
    const next = state.sealed[remove.length];
    if (next === undefined)
      throw new SegmentedEventHistoryError("event_history_retention_blocked");
    atomicWrite(
      join(this.#root, "transaction.json"),
      `${canonicalJson({ schemaVersion: 1, operation: "retention", removedSegmentCount: remove.length })}\n`,
      0o600,
    );
    const ledgerPath = join(this.#root, "retention-ledger.jsonl");
    const previousLedger = readLastLine(ledgerPath, this.#currentUserId());
    let previousRetentionRecordSha256 = EVENT_HISTORY_GENESIS_SHA256;
    if (previousLedger !== undefined) {
      try {
        previousRetentionRecordSha256 = parseRetentionAnchor(
          parseStrictJson(previousLedger),
        ).retentionRecordSha256;
      } catch {
        throw new SegmentedEventHistoryError("event_history_corrupted");
      }
    }
    const nextFirstRecord = state.records.find(
      (record) => record.sequence === next.manifest.firstSequence,
    );
    if (nextFirstRecord === undefined)
      throw new SegmentedEventHistoryError("event_history_retention_blocked");
    const anchorUnsigned = {
      schemaVersion: 1 as const,
      retentionSequence: state.latestSequence,
      removedFirstSequence: remove[0]!.manifest.firstSequence,
      removedLastSequence: last.manifest.lastSequence,
      removedEventCount: remove.reduce(
        (sum, item) => sum + item.manifest.eventCount,
        0,
      ),
      removedSegmentCount: remove.length,
      removedFirstRecordSha256: remove[0]!.manifest.firstRecordSha256,
      removedLastRecordSha256: last.manifest.lastRecordSha256,
      removedSegmentChainHead: last.manifest.manifestSha256,
      nextRetainedSequence: next.manifest.firstSequence,
      nextRetainedPreviousRecordSha256: nextFirstRecord.previousRecordSha256,
      previousRetentionRecordSha256,
      prunedAt: this.#clock(),
    };
    const anchor = {
      ...anchorUnsigned,
      retentionRecordSha256: sha256(canonicalJson(anchorUnsigned)),
    };
    appendFileSync(ledgerPath, `${canonicalJson(anchor)}\n`, { mode: 0o600 });
    syncFile(ledgerPath);
    for (const item of remove) {
      rmSync(join(this.#segmentsPath(), item.name));
      rmSync(join(this.#segmentsPath(), `${item.name}.manifest.json`));
    }
    rmSync(join(this.#root, "transaction.json"));
    return Object.freeze({
      outcome: "pruned" as const,
      removedSegmentCount: remove.length,
      removedEventCount: anchor.removedEventCount,
    });
  }

  #createExportOne(input: unknown): EventHistoryExportResult {
    const request = parseExportRequest(input);
    const state = this.#reconstruct();
    if (
      request.fromSequence < state.earliestRetainedSequence ||
      request.throughSequence > state.latestSequence ||
      request.fromSequence > request.throughSequence
    )
      throw new SegmentedEventHistoryError("event_history_history_pruned");
    const events = state.events.filter(
      (event) =>
        event.sequence >= request.fromSequence &&
        event.sequence <= request.throughSequence,
    );
    if (events.length > EVENT_HISTORY_MAX_EXPORT_EVENTS)
      throw new SegmentedEventHistoryError("event_history_capacity_exceeded");
    const header = `${canonicalJson({ schemaVersion: 1, kind: "atlas-manager-event-history-export", fromSequence: request.fromSequence, throughSequence: request.throughSequence, generatedAt: this.#clock(), filters: {}, earliestRetainedSequence: state.earliestRetainedSequence, retentionAnchorSha256: state.retentionAnchorPresent ? this.#retentionAnchorHash() : EVENT_HISTORY_GENESIS_SHA256 })}\n`;
    const eventLines = events
      .map((event) => `${canonicalJson({ kind: "event", event })}\n`)
      .join("");
    const first = events[0];
    const last = events[events.length - 1];
    const footerBase = `${canonicalJson({ kind: "footer", exportedEventCount: events.length, firstExportedSequence: first?.sequence ?? 0, lastExportedSequence: last?.sequence ?? 0, firstRecordSha256: first ? state.records.find((record) => record.sequence === first.sequence)?.recordSha256 : EVENT_HISTORY_GENESIS_SHA256, lastRecordSha256: last ? state.records.find((record) => record.sequence === last.sequence)?.recordSha256 : EVENT_HISTORY_GENESIS_SHA256, eventContentSha256: sha256(eventLines), exportSha256: "" })}\n`;
    const provisional = Buffer.from(header + eventLines + footerBase, "utf8");
    const exportSha = sha256(provisional);
    const footer = `${canonicalJson({ kind: "footer", exportedEventCount: events.length, firstExportedSequence: first?.sequence ?? 0, lastExportedSequence: last?.sequence ?? 0, firstRecordSha256: first ? state.records.find((record) => record.sequence === first.sequence)?.recordSha256 : EVENT_HISTORY_GENESIS_SHA256, lastRecordSha256: last ? state.records.find((record) => record.sequence === last.sequence)?.recordSha256 : EVENT_HISTORY_GENESIS_SHA256, eventContentSha256: sha256(eventLines), exportSha256: exportSha })}\n`;
    const content = Buffer.from(header + eventLines + footer, "utf8");
    if (content.byteLength > EVENT_HISTORY_MAX_EXPORT_BYTES)
      throw new SegmentedEventHistoryError("event_history_capacity_exceeded");
    const exportId = sha256(content);
    const metadata: EventHistoryExportMetadata = Object.freeze({
      schemaVersion: 1,
      exportId,
      fromSequence: request.fromSequence,
      throughSequence: request.throughSequence,
      eventCount: events.length,
      byteCount: content.byteLength,
      contentSha256: exportId,
      createdAt: this.#clock(),
      retentionAnchorSha256: state.retentionAnchorPresent
        ? this.#retentionAnchorHash()
        : EVENT_HISTORY_GENESIS_SHA256,
    });
    const existing = this.#getExportUnsafe(exportId);
    if (existing !== undefined)
      return Object.freeze({
        outcome: "unchanged" as const,
        metadata: existing,
      });
    ensureRoot(this.#root, this.#currentUserId());
    const candidate = join(this.#exportsPath(), `${exportId}.candidate`);
    writeFileSync(candidate, content, { mode: 0o400, flag: "wx" });
    syncFile(candidate);
    atomicWrite(`${candidate}.manifest`, `${canonicalJson(metadata)}\n`, 0o400);
    renameSync(candidate, join(this.#exportsPath(), `${exportId}.jsonl`));
    renameSync(
      `${candidate}.manifest`,
      join(this.#exportsPath(), `${exportId}.manifest.json`),
    );
    return Object.freeze({ outcome: "created" as const, metadata });
  }

  #reconstruct(): Reconstruction {
    if (!existsSync(this.#root)) return emptyReconstruction();
    if (readdirSync(this.#root).length === 0) return emptyReconstruction();
    validateExistingRoot(this.#root, this.#currentUserId());
    if (existsSync(join(this.#root, "transaction.json")))
      throw new SegmentedEventHistoryError("event_history_interrupted");
    const entries = readdirSync(this.#segmentsPath(), { withFileTypes: true });
    const names = entries.map((entry) => entry.name);
    if (
      names.some(
        (name) =>
          !/^segment-[0-9]{20}-[0-9]{20}\.jsonl(?:\.manifest\.json)?$/u.test(
            name,
          ),
      )
    )
      throw new SegmentedEventHistoryError("event_history_corrupted");
    const segmentNames = names.filter((name) => name.endsWith(".jsonl")).sort();
    const sealed: Array<{
      name: string;
      manifest: EventHistorySegmentManifest;
      bytes: Buffer;
    }> = [];
    const records: EventHistoryRecord[] = [];
    let expectedSequence = 1;
    let previousRecord = EVENT_HISTORY_GENESIS_SHA256;
    let previousSegment = EVENT_HISTORY_GENESIS_SHA256;
    const anchor = this.#readRetentionAnchor();
    if (anchor !== undefined) {
      expectedSequence = anchor.nextRetainedSequence;
      previousRecord = anchor.nextRetainedPreviousRecordSha256;
      previousSegment = anchor.removedSegmentChainHead;
    }
    for (const name of segmentNames) {
      const bytes = readSafeFile(
        join(this.#segmentsPath(), name),
        this.#currentUserId(),
        0o400,
      );
      const manifestPath = join(this.#segmentsPath(), `${name}.manifest.json`);
      if (!existsSync(manifestPath))
        throw new SegmentedEventHistoryError("event_history_corrupted");
      const manifest = parseSegmentManifest(
        parseStrictJson(
          readSafeFile(manifestPath, this.#currentUserId(), 0o400).toString(
            "utf8",
          ),
        ),
      );
      const parsed = parseRecords(bytes, previousRecord);
      if (
        parsed.length === 0 ||
        parsed[0]!.sequence !== expectedSequence ||
        parsed[0]!.previousRecordSha256 !== previousRecord ||
        manifest.segmentContentSha256 !== sha256(bytes) ||
        manifest.byteCount !== bytes.byteLength ||
        manifest.previousSegmentSha256 !== previousSegment ||
        manifest.firstSequence !== parsed[0]!.sequence ||
        manifest.lastSequence !== parsed[parsed.length - 1]!.sequence ||
        manifest.eventCount !== parsed.length ||
        manifest.lastRecordSha256 !== parsed[parsed.length - 1]!.recordSha256
      )
        throw new SegmentedEventHistoryError("event_history_corrupted");
      const expectedName = segmentFileName(
        manifest.firstSequence,
        manifest.lastSequence,
      );
      if (name !== expectedName)
        throw new SegmentedEventHistoryError("event_history_corrupted");
      sealed.push({ name, manifest, bytes });
      records.push(...parsed);
      expectedSequence = manifest.lastSequence + 1;
      previousRecord = manifest.lastRecordSha256;
      previousSegment = manifest.manifestSha256;
    }
    const activeBytes = existsSync(this.#activePath())
      ? readSafeFile(this.#activePath(), this.#currentUserId(), 0o600)
      : Buffer.alloc(0);
    const activeRecords = parseRecords(activeBytes, previousRecord);
    if (
      activeRecords.length > this.#maxSegmentEvents ||
      activeBytes.byteLength > this.#maxSegmentBytes
    )
      throw new SegmentedEventHistoryError("event_history_capacity_exceeded");
    if (
      activeRecords.length > 0 &&
      (activeRecords[0]!.sequence !== expectedSequence ||
        activeRecords[0]!.previousRecordSha256 !== previousRecord)
    )
      throw new SegmentedEventHistoryError("event_history_corrupted");
    records.push(...activeRecords);
    return Object.freeze({
      events: Object.freeze(records.map((record) => record.event)),
      records: Object.freeze(records),
      sealed: Object.freeze(sealed),
      activeBytes,
      activeRecords: Object.freeze(activeRecords),
      earliestRetainedSequence: records[0]?.sequence ?? expectedSequence,
      latestSequence: records.at(-1)?.sequence ?? expectedSequence - 1,
      lastRecordSha256: records.at(-1)?.recordSha256 ?? previousRecord,
      lastSegmentSha256:
        sealed.at(-1)?.manifest.manifestSha256 ?? previousSegment,
      retentionAnchorPresent: anchor !== undefined,
    });
  }

  #readPolicy(): EventHistoryRetentionPolicy {
    const path = join(this.#root, "retention-policy.json");
    if (!existsSync(path)) {
      return (
        this.#initialRetentionPolicy ?? DEFAULT_EVENT_HISTORY_RETENTION_POLICY
      );
    }
    return createRetentionPolicy(
      parseStrictJson(
        readSafeFile(path, this.#currentUserId(), 0o600).toString("utf8"),
      ),
    );
  }

  #listExportsUnsafe(): readonly EventHistoryExportMetadata[] {
    if (!existsSync(this.#root)) return Object.freeze([]);
    if (readdirSync(this.#root).length === 0) return Object.freeze([]);
    validateExistingRoot(this.#root, this.#currentUserId());
    const entries = readdirSync(this.#exportsPath(), { withFileTypes: true });
    if (
      entries.some(
        (entry) =>
          !entry.isFile() ||
          !/^[0-9a-f]{64}\.(jsonl|manifest\.json)$/u.test(entry.name),
      )
    )
      throw new SegmentedEventHistoryError("event_history_corrupted");
    const names = new Set(entries.map((entry) => entry.name));
    for (const entry of entries) {
      const pair = entry.name.endsWith(".manifest.json")
        ? entry.name.replace(/\.manifest\.json$/u, ".jsonl")
        : entry.name.replace(/\.jsonl$/u, ".manifest.json");
      if (!names.has(pair))
        throw new SegmentedEventHistoryError("event_history_corrupted");
    }
    const result: EventHistoryExportMetadata[] = [];
    for (const entry of entries
      .filter((item) => item.name.endsWith(".manifest.json"))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const metadata = parseExportMetadata(
        parseStrictJson(
          readSafeFile(
            join(this.#exportsPath(), entry.name),
            this.#currentUserId(),
            0o400,
          ).toString("utf8"),
        ),
      );
      if (metadata.exportId !== entry.name.replace(/\.manifest\.json$/u, ""))
        throw new SegmentedEventHistoryError("event_history_export_corrupt");
      this.#readVerifiedExportContent(metadata.exportId, metadata);
      result.push(metadata);
    }
    return Object.freeze(
      result.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.exportId.localeCompare(b.exportId),
      ),
    );
  }

  #getExportUnsafe(exportId: string): EventHistoryExportMetadata | undefined {
    if (!/^[0-9a-f]{64}$/u.test(exportId)) return undefined;
    if (!existsSync(this.#exportsPath())) return undefined;
    const path = join(this.#exportsPath(), `${exportId}.manifest.json`);
    if (!existsSync(path)) return undefined;
    const metadata = parseExportMetadata(
      parseStrictJson(
        readSafeFile(path, this.#currentUserId(), 0o400).toString("utf8"),
      ),
    );
    if (metadata.exportId !== exportId)
      throw new SegmentedEventHistoryError("event_history_export_corrupt");
    this.#readVerifiedExportContent(exportId, metadata);
    return metadata;
  }

  #readVerifiedExportContent(
    exportId: string,
    metadata: EventHistoryExportMetadata,
  ): Buffer {
    try {
      const content = readSafeFile(
        join(this.#exportsPath(), `${exportId}.jsonl`),
        this.#currentUserId(),
        0o400,
      );
      if (
        metadata.exportId !== sha256(content) ||
        metadata.contentSha256 !== sha256(content) ||
        metadata.byteCount !== content.byteLength
      )
        throw new Error("corrupt");
      return content;
    } catch {
      throw new SegmentedEventHistoryError("event_history_export_corrupt");
    }
  }

  #readRetentionAnchor():
    | Readonly<{
        nextRetainedSequence: number;
        nextRetainedPreviousRecordSha256: string;
        removedSegmentChainHead: string;
      }>
    | undefined {
    const path = join(this.#root, "retention-ledger.jsonl");
    if (!existsSync(path)) return undefined;
    const lines = readSafeFile(path, this.#currentUserId(), 0o600)
      .toString("utf8")
      .split("\n")
      .filter(Boolean);
    let previous = EVENT_HISTORY_GENESIS_SHA256;
    let latest:
      | Readonly<{
          nextRetainedSequence: number;
          nextRetainedPreviousRecordSha256: string;
          removedSegmentChainHead: string;
        }>
      | undefined;
    for (const line of lines) {
      let anchor: ReturnType<typeof parseRetentionAnchor>;
      try {
        anchor = parseRetentionAnchor(parseStrictJson(line));
      } catch {
        throw new SegmentedEventHistoryError("event_history_corrupted");
      }
      if (anchor.previousRetentionRecordSha256 !== previous)
        throw new SegmentedEventHistoryError("event_history_corrupted");
      latest = {
        nextRetainedSequence: anchor.nextRetainedSequence,
        nextRetainedPreviousRecordSha256:
          anchor.nextRetainedPreviousRecordSha256,
        removedSegmentChainHead: anchor.removedSegmentChainHead,
      };
      previous = anchor.retentionRecordSha256;
    }
    return latest;
  }

  #retentionAnchorHash(): string {
    const line = readLastLine(
      join(this.#root, "retention-ledger.jsonl"),
      this.#currentUserId(),
    );
    if (line === undefined) return EVENT_HISTORY_GENESIS_SHA256;
    try {
      return parseRetentionAnchor(parseStrictJson(line)).retentionRecordSha256;
    } catch {
      throw new SegmentedEventHistoryError("event_history_corrupted");
    }
  }

  #withWriterLock<T>(operation: () => T): T {
    let handle: Readonly<{ token: string }>;
    try {
      handle = this.#writerLock.acquire("event-history");
    } catch (error) {
      if (error instanceof FileEventHistoryWriterLockError) {
        const code =
          error.code === "busy"
            ? "event_history_writer_busy"
            : error.code === "stale"
              ? "event_history_writer_stale"
              : "event_history_writer_invalid";
        throw new SegmentedEventHistoryError(code);
      }
      throw new SegmentedEventHistoryError("event_history_writer_invalid");
    }
    try {
      return operation();
    } finally {
      this.#writerLock.release(handle.token);
    }
  }

  #activePath(): string {
    return join(this.#root, "active.jsonl");
  }
  #segmentsPath(): string {
    return join(this.#root, "segments");
  }
  #exportsPath(): string {
    return join(this.#root, "exports");
  }
}

function parseRecords(
  bytes: Buffer,
  initialPrevious: string,
): EventHistoryRecord[] {
  if (bytes.byteLength === 0) return [];
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.endsWith("\n") || text.includes("\r"))
    throw new SegmentedEventHistoryError("event_history_corrupted");
  const result: EventHistoryRecord[] = [];
  let previous = initialPrevious;
  let previousSequence = 0;
  for (const line of text.split("\n").slice(0, -1)) {
    if (Buffer.byteLength(`${line}\n`, "utf8") > EVENT_HISTORY_MAX_RECORD_BYTES)
      throw new SegmentedEventHistoryError("event_history_capacity_exceeded");
    let record: EventHistoryRecord;
    try {
      record = parseEventHistoryRecordLine(`${line}\n`);
    } catch {
      throw new SegmentedEventHistoryError("event_history_corrupted");
    }
    if (
      record.previousRecordSha256 !== previous ||
      (previousSequence > 0 && record.sequence !== previousSequence + 1)
    )
      throw new SegmentedEventHistoryError("event_history_corrupted");
    result.push(record);
    previous = record.recordSha256;
    previousSequence = record.sequence;
  }
  return result;
}

function parseExportRequest(input: unknown): EventHistoryExportRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new SegmentedEventHistoryError("event_history_export_corrupt");
  const record = input as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).length !== 2 ||
    !Number.isSafeInteger(record.fromSequence) ||
    !Number.isSafeInteger(record.throughSequence) ||
    (record.fromSequence as number) < 1 ||
    (record.throughSequence as number) < 1
  )
    throw new SegmentedEventHistoryError("event_history_export_corrupt");
  return Object.freeze({
    fromSequence: record.fromSequence as number,
    throughSequence: record.throughSequence as number,
  });
}

function parseExportMetadata(input: unknown): EventHistoryExportMetadata {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new SegmentedEventHistoryError("event_history_export_corrupt");
  const record = input as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).length !== 9 ||
    record.schemaVersion !== 1 ||
    typeof record.exportId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.exportId) ||
    !isPositiveInteger(record.fromSequence) ||
    !isPositiveInteger(record.throughSequence) ||
    record.throughSequence < record.fromSequence ||
    !isNonNegativeInteger(record.eventCount) ||
    !isNonNegativeInteger(record.byteCount) ||
    typeof record.contentSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.contentSha256) ||
    !isCanonicalTimestamp(record.createdAt) ||
    typeof record.retentionAnchorSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.retentionAnchorSha256)
  )
    throw new SegmentedEventHistoryError("event_history_export_corrupt");
  return Object.freeze(record as unknown as EventHistoryExportMetadata);
}

function matchesQuery(
  event: AdministrativeEvent,
  query: AdministrativeEventHistoryQuery,
): boolean {
  return (
    (query.source === undefined || event.source.kind === query.source) &&
    (query.operation === undefined || event.operation === query.operation) &&
    (query.status === undefined || event.status === query.status) &&
    (query.attemptId === undefined || event.attemptId === query.attemptId) &&
    (query.occurredFrom === undefined ||
      event.occurredAt >= query.occurredFrom) &&
    (query.occurredTo === undefined || event.occurredAt < query.occurredTo) &&
    event.sequence > query.afterSequence
  );
}

function ensureRoot(root: string, uid: number): void {
  ensureParent(root, uid);
  if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
  validateDirectory(root, uid, 0o700);
  for (const path of [join(root, "segments"), join(root, "exports")]) {
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    validateDirectory(path, uid, 0o700);
  }
}

function validateExistingRoot(root: string, uid: number): void {
  validateDirectory(root, uid, 0o700);
  const allowed = new Set([
    "active.jsonl",
    "segments",
    "exports",
    "retention-ledger.jsonl",
    "retention-policy.json",
    "transaction.json",
    "migration",
    "stale-lock-recovery-receipt.json",
  ]);
  if (readdirSync(root).some((name) => !allowed.has(name)))
    throw new SegmentedEventHistoryError("event_history_corrupted");
  for (const path of [join(root, "segments"), join(root, "exports")]) {
    if (!existsSync(path))
      throw new SegmentedEventHistoryError("event_history_corrupted");
    validateDirectory(path, uid, 0o700);
  }
  const migration = join(root, "migration");
  if (existsSync(migration)) {
    validateDirectory(migration, uid, 0o700);
    const allowedMigration = new Set([
      "version-one-migration-receipt.json",
      "stale-lock-recovery-receipt.json",
    ]);
    if (readdirSync(migration).some((name) => !allowedMigration.has(name)))
      throw new SegmentedEventHistoryError("event_history_corrupted");
  }
}

function emptyReconstruction(): Reconstruction {
  return Object.freeze({
    events: Object.freeze([]),
    records: Object.freeze([]),
    sealed: Object.freeze([]),
    activeBytes: Buffer.alloc(0),
    activeRecords: Object.freeze([]),
    earliestRetainedSequence: 1,
    latestSequence: 0,
    lastRecordSha256: EVENT_HISTORY_GENESIS_SHA256,
    lastSegmentSha256: EVENT_HISTORY_GENESIS_SHA256,
    retentionAnchorPresent: false,
  });
}

function ensureParent(path: string, uid: number): void {
  void uid;
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stats = lstatSync(parent);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    ((stats.mode & 0o002) !== 0 && (stats.mode & 0o1000) === 0)
  )
    throw new SegmentedEventHistoryError("event_history_parent_invalid");
}

function validateDirectory(
  path: string,
  uid: number,
  mode: number,
  allowWritable = false,
): void {
  void mode;
  const stats = lstatSync(path);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.nlink < 2 ||
    stats.uid !== uid ||
    (!allowWritable && (stats.mode & 0o077) !== 0)
  )
    throw new SegmentedEventHistoryError("event_history_permissions_unsafe");
}

function readSafeFile(path: string, uid: number, mode: number): Buffer {
  const stats = lstatSync(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1 ||
    stats.uid !== uid ||
    (stats.mode & 0o077) !== 0
  )
    throw new SegmentedEventHistoryError("event_history_permissions_unsafe");
  if (mode === 0o400 && (stats.mode & 0o777) !== 0o400)
    throw new SegmentedEventHistoryError("event_history_permissions_unsafe");
  return readFileSync(path);
}

function validateStaleLockRecoveryReceipt(path: string, uid: number): void {
  const value = parseStrictJson(
    readSafeFile(path, uid, 0o600).toString("utf8"),
  );
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 3
  )
    throw new SegmentedEventHistoryError("event_history_corrupted");
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    record.result !== "recovered" ||
    !isCanonicalTimestamp(record.recoveredAt)
  )
    throw new SegmentedEventHistoryError("event_history_corrupted");
}

function atomicWrite(path: string, content: string, mode: number): void {
  const candidate = `${path}.${randomUUID()}.candidate`;
  writeFileSync(candidate, content, { mode, flag: "wx" });
  chmodSync(candidate, mode);
  syncFile(candidate);
  renameSync(candidate, path);
  chmodSync(path, mode);
}

function syncFile(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function segmentFileName(first: number, last: number): string {
  return `segment-${String(first).padStart(20, "0")}-${String(last).padStart(20, "0")}.jsonl`;
}

function readLastLine(
  path: string,
  uid = defaultCurrentUserId(),
): string | undefined {
  if (!existsSync(path)) return undefined;
  const lines = readSafeFile(path, uid, 0o600)
    .toString("utf8")
    .split("\n")
    .filter(Boolean);
  return lines.at(-1);
}

function validateConfiguredPath(path: string): void {
  if (
    !isAbsolute(path) ||
    path === "/" ||
    path.trim() !== path ||
    path.includes("\0")
  )
    throw new SegmentedEventHistoryError("event_history_path_invalid");
}

function validateLimit(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new SegmentedEventHistoryError("event_history_capacity_exceeded");
  return value;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function defaultCurrentUserId(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}
