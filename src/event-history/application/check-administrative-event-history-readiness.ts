import type {
  AdministrativeEventHistoryReadinessReader,
  AdministrativeEventHistoryReadinessResult,
} from "./ports/administrative-event-history-reader.js";

export class CheckAdministrativeEventHistoryReadiness {
  readonly #reader: AdministrativeEventHistoryReadinessReader;
  public constructor(reader: AdministrativeEventHistoryReadinessReader) {
    this.#reader = reader;
    Object.freeze(this);
  }
  public execute(): Promise<AdministrativeEventHistoryReadinessResult> {
    return this.#reader.check();
  }
}
