import { CheckAdministrativeEventHistoryReadiness } from "../application/check-administrative-event-history-readiness.js";
import { GetAdministrativeEventHistory } from "../application/get-administrative-event-history.js";
import { RecordAdministrativeEvent } from "../application/record-administrative-event.js";
import type { AdministrativeEventRecorder } from "../application/ports/administrative-event-recorder.js";
import type {
  AdministrativeEventHistoryReadinessReader,
  AdministrativeEventHistoryReader,
} from "../application/ports/administrative-event-history-reader.js";
import {
  FileAdministrativeEventHistory,
  type FileAdministrativeEventHistoryDependencies,
} from "../infrastructure/file-administrative-event-history.js";
import { InMemoryAdministrativeEventHistory } from "../infrastructure/in-memory-administrative-event-history.js";

export interface EventHistoryCompositionOverrides {
  readonly filePath?: string;
  readonly persistence?: unknown;
  readonly recorder?: AdministrativeEventRecorder;
  readonly reader?: AdministrativeEventHistoryReader;
  readonly readiness?: AdministrativeEventHistoryReadinessReader;
  readonly fileDependencies?: FileAdministrativeEventHistoryDependencies;
}

export interface EventHistoryCapabilities {
  readonly recordAdministrativeEvent: RecordAdministrativeEvent;
  readonly getAdministrativeEventHistory: GetAdministrativeEventHistory;
  readonly checkAdministrativeEventHistoryReadiness: CheckAdministrativeEventHistoryReadiness;
}

export function createEventHistory(
  overrides: EventHistoryCompositionOverrides = {},
): EventHistoryCapabilities {
  const keys = Object.keys(overrides);
  const allowed = [
    "filePath",
    "persistence",
    "recorder",
    "reader",
    "readiness",
    "fileDependencies",
  ];
  if (keys.some((key) => !allowed.includes(key)))
    throw new EventHistoryCompositionError("invalid_configuration");
  if (overrides.filePath !== undefined && overrides.persistence !== undefined)
    throw new EventHistoryCompositionError("invalid_configuration");
  let recorder: AdministrativeEventRecorder;
  let reader: AdministrativeEventHistoryReader;
  let readiness: AdministrativeEventHistoryReadinessReader;
  if (overrides.recorder || overrides.reader || overrides.readiness) {
    if (!overrides.recorder || !overrides.reader || !overrides.readiness)
      throw new EventHistoryCompositionError("invalid_configuration");
    recorder = overrides.recorder;
    reader = overrides.reader;
    readiness = overrides.readiness;
  } else if (
    overrides.filePath !== undefined ||
    overrides.persistence !== undefined
  ) {
    const filePath =
      overrides.filePath ?? extractFilePath(overrides.persistence);
    const store = new FileAdministrativeEventHistory(
      filePath,
      overrides.fileDependencies,
    );
    recorder = store;
    reader = store;
    readiness = store;
  } else {
    const store = new InMemoryAdministrativeEventHistory();
    recorder = store;
    reader = store;
    readiness = store;
  }
  return Object.freeze({
    recordAdministrativeEvent: new RecordAdministrativeEvent(recorder),
    getAdministrativeEventHistory: new GetAdministrativeEventHistory(reader),
    checkAdministrativeEventHistoryReadiness:
      new CheckAdministrativeEventHistoryReadiness(readiness),
  });
}

function extractFilePath(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new EventHistoryCompositionError("invalid_configuration");
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record["filePath"] !== "string"
  )
    throw new EventHistoryCompositionError("invalid_configuration");
  return record["filePath"];
}

export class EventHistoryCompositionError extends Error {
  public override readonly name = "EventHistoryCompositionError";
  public constructor(public readonly code: "invalid_configuration") {
    super(`Invalid event-history composition: ${code}`);
    Object.freeze(this);
  }
}
