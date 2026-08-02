import type {
  AdministrativeEvent,
  AdministrativeEventDetails,
  AdministrativeEventOperation,
} from "../event-history/domain/administrative-event.js";
import type { AdministrativeEventHistoryPage } from "../event-history/domain/administrative-event-history-page.js";

export interface AdministrativeEventHistoryHttpResponse {
  readonly events: readonly AdministrativeEventHttpResponse[];
  readonly hasMore: boolean;
  readonly nextAfterSequence?: number;
}

export interface AdministrativeEventHttpResponse {
  readonly sequence: number;
  readonly attemptId: string;
  readonly occurredAt: string;
  readonly source: Readonly<{ kind: string; actorId: string }>;
  readonly target: Readonly<{ kind: "machine"; id: "atlas" }>;
  readonly operation: AdministrativeEventOperation;
  readonly status: string;
  readonly details: AdministrativeEventDetails;
}

export function mapAdministrativeEventHistoryResponse(
  page: AdministrativeEventHistoryPage,
): AdministrativeEventHistoryHttpResponse {
  const events = Object.freeze(page.events.map(mapAdministrativeEvent));
  return Object.freeze({
    events,
    hasMore: page.hasMore,
    ...(page.hasMore && events.length > 0
      ? { nextAfterSequence: page.nextAfterSequence }
      : {}),
  });
}

function mapAdministrativeEvent(
  event: AdministrativeEvent,
): AdministrativeEventHttpResponse {
  return Object.freeze({
    sequence: event.sequence,
    attemptId: event.attemptId,
    occurredAt: event.occurredAt,
    source: Object.freeze({
      kind: event.source.kind,
      actorId: event.source.actorId,
    }),
    target: Object.freeze({ kind: "machine" as const, id: "atlas" as const }),
    operation: event.operation,
    status: event.status,
    details: mapDetails(event.operation, event.details),
  });
}

function mapDetails(
  operation: AdministrativeEventOperation,
  details: AdministrativeEventDetails | undefined,
): AdministrativeEventDetails {
  if (details === undefined) return Object.freeze({});
  const fields = fieldsForOperation(operation);
  const mapped: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(details, field))
      mapped[field] = copyValue(details[field]);
  }
  return Object.freeze(mapped);
}

function fieldsForOperation(
  operation: AdministrativeEventOperation,
): readonly string[] {
  if (operation === "authorize_administrative_operation")
    return ["requestedOperation", "permission", "decision", "reasonCode"];
  if (operation === "schedule_wake_alarm")
    return ["scheduledFor", "mutationOutcome", "failureCode"];
  if (operation === "cancel_wake_alarm")
    return ["mutationOutcome", "failureCode"];
  if (operation === "request_machine_shutdown")
    return ["accepted", "failureCode"];
  if (operation === "prepare_machine_shutdown_occurrence")
    return [
      "scheduledFor",
      "wakeScheduledFor",
      "preparationOutcome",
      "blockerCodes",
      "completedStepCount",
      "failureCode",
    ];
  if (operation === "execute_machine_shutdown_occurrence")
    return [
      "scheduledFor",
      "wakeScheduledFor",
      "executionOutcome",
      "preparationOutcome",
      "wakeMutationOutcome",
      "shutdownAccepted",
      "failureCode",
      "blockerCodes",
    ];
  if (
    operation === "start_registered_service" ||
    operation === "stop_registered_service" ||
    operation === "restart_registered_service" ||
    operation === "update_registered_service_availability" ||
    operation === "remove_registered_service_availability"
  )
    return ["serviceId", "outcome", "failureCode"];
  if (
    operation === "verify_event_history_integrity" ||
    operation === "rotate_administrative_event_history" ||
    operation === "update_administrative_event_history_retention" ||
    operation === "prune_administrative_event_history" ||
    operation === "create_administrative_event_history_export" ||
    operation === "prune_administrative_event_history_exports" ||
    operation === "recover_administrative_event_history_stale_lock" ||
    operation === "migrate_administrative_event_history_v1" ||
    operation === "read_event_history_retention" ||
    operation === "list_event_history_exports" ||
    operation === "read_event_history_export" ||
    operation === "download_event_history_export"
  )
    return [
      "outcome",
      "firstSequence",
      "lastSequence",
      "processedSegmentCount",
      "processedExportCount",
      "exportId",
      "failureCode",
      "fromSequence",
      "throughSequence",
    ];
  return [
    "tickedThrough",
    "schedulerOutcome",
    "completedThrough",
    "occurrenceCount",
    "complete",
    "failureCode",
  ];
}

function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(copyValue));
  return value;
}
