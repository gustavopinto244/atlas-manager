import type { AdministrativeEventHistoryPage } from "../../domain/administrative-event-history-page.js";
import type { AdministrativeEventHistoryQuery } from "../../domain/administrative-event-history-query.js";
import type { AdministrativeEventRecorder } from "./administrative-event-recorder.js";

export interface AdministrativeEventHistoryReader {
  query(input?: unknown): Promise<AdministrativeEventHistoryPage>;
}

export type AdministrativeEventHistoryReadinessResult =
  | Readonly<{ outcome: "ready" }>
  | Readonly<{
      outcome: "unavailable";
      code: "event_history_unavailable" | "event_history_corrupted";
    }>;

export interface AdministrativeEventHistoryReadinessReader {
  check(): Promise<AdministrativeEventHistoryReadinessResult>;
}

export type AdministrativeEventHistoryCapabilities = Readonly<{
  recordAdministrativeEvent: AdministrativeEventRecorder;
  getAdministrativeEventHistory: AdministrativeEventHistoryReader;
  checkAdministrativeEventHistoryReadiness: AdministrativeEventHistoryReadinessReader;
}>;

export type { AdministrativeEventHistoryQuery };
