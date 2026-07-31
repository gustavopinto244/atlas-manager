import {
  createAdministrativeEvent,
  createAdministrativeEventInput,
  type AdministrativeEvent,
  type AdministrativeEventInput,
} from "../domain/administrative-event.js";
import { createAdministrativeEventHistoryPage } from "../domain/administrative-event-history-page.js";
import {
  createAdministrativeEventHistoryQuery,
  type AdministrativeEventHistoryQuery,
} from "../domain/administrative-event-history-query.js";
import type { AdministrativeEventRecorder } from "../application/ports/administrative-event-recorder.js";
import type { AdministrativeEventHistoryPage } from "../domain/administrative-event-history-page.js";
import type {
  AdministrativeEventHistoryReadinessReader,
  AdministrativeEventHistoryReadinessResult,
  AdministrativeEventHistoryReader,
} from "../application/ports/administrative-event-history-reader.js";

export interface InMemoryAdministrativeEventHistoryConfiguration {
  readonly recordFailure?: Error;
  readonly queryFailure?: Error;
  readonly readiness?: "ready" | "unavailable";
}

export type AdministrativeEventHistoryErrorCode =
  "event_history_read_failed" | "event_history_write_failed";

export class InMemoryAdministrativeEventHistoryError extends Error {
  public override readonly name = "InMemoryAdministrativeEventHistoryError";
  public constructor(
    public readonly code: AdministrativeEventHistoryErrorCode,
  ) {
    super(`In-memory event history failed: ${code}`);
    Object.freeze(this);
  }
}

export class InMemoryAdministrativeEventHistory
  implements
    AdministrativeEventRecorder,
    AdministrativeEventHistoryReader,
    AdministrativeEventHistoryReadinessReader
{
  readonly #events: AdministrativeEvent[] = [];
  readonly #recordFailure: Error | undefined;
  readonly #queryFailure: Error | undefined;
  readonly #readiness: "ready" | "unavailable";
  #tail: Promise<void> = Promise.resolve();

  public constructor(
    configuration: InMemoryAdministrativeEventHistoryConfiguration = {},
  ) {
    this.#recordFailure = configuration.recordFailure;
    this.#queryFailure = configuration.queryFailure;
    this.#readiness = configuration.readiness ?? "ready";
    Object.freeze(this);
  }

  public record(input: AdministrativeEventInput): Promise<AdministrativeEvent> {
    const validated = createAdministrativeEventInput(input);
    const operation = this.#tail.then(
      () => this.#recordOne(validated),
      () => this.#recordOne(validated),
    );
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public query(input?: unknown): Promise<AdministrativeEventHistoryPage> {
    const query = createAdministrativeEventHistoryQuery(input);
    const operation = this.#tail.then(
      () => this.#queryOne(query),
      () => this.#queryOne(query),
    );
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public async check(): Promise<AdministrativeEventHistoryReadinessResult> {
    await this.#tail;
    return this.#readiness === "ready"
      ? Object.freeze({ outcome: "ready" as const })
      : Object.freeze({
          outcome: "unavailable" as const,
          code: "event_history_unavailable" as const,
        });
  }

  public get snapshots(): readonly AdministrativeEvent[] {
    return Object.freeze(
      this.#events.map((event) => createAdministrativeEvent(event)),
    );
  }

  #recordOne(input: AdministrativeEventInput): AdministrativeEvent {
    if (this.#recordFailure)
      throw new InMemoryAdministrativeEventHistoryError(
        "event_history_write_failed",
      );
    const event = createAdministrativeEvent({
      sequence: this.#events.length + 1,
      ...input,
    });
    this.#events.push(event);
    return createAdministrativeEvent(event);
  }

  #queryOne(
    query: AdministrativeEventHistoryQuery,
  ): AdministrativeEventHistoryPage {
    if (this.#queryFailure)
      throw new InMemoryAdministrativeEventHistoryError(
        "event_history_read_failed",
      );
    const matches = this.#events.filter((event) => matchesQuery(event, query));
    const events = matches
      .slice(0, query.limit)
      .map((event) => createAdministrativeEvent(event));
    return createAdministrativeEventHistoryPage({
      events,
      hasMore: matches.length > query.limit,
    });
  }
}

function matchesQuery(
  event: AdministrativeEvent,
  query: AdministrativeEventHistoryQuery,
): boolean {
  return (
    event.sequence > query.afterSequence &&
    (query.source === undefined || event.source.kind === query.source) &&
    (query.operation === undefined || event.operation === query.operation) &&
    (query.status === undefined || event.status === query.status) &&
    (query.attemptId === undefined || event.attemptId === query.attemptId) &&
    (query.occurredFrom === undefined ||
      event.occurredAt >= query.occurredFrom) &&
    (query.occurredTo === undefined || event.occurredAt < query.occurredTo)
  );
}
