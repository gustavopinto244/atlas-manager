import type { AdministrativeEventHistoryPage } from "../domain/administrative-event-history-page.js";
import type { AdministrativeEventHistoryReader } from "./ports/administrative-event-history-reader.js";

export class GetAdministrativeEventHistory {
  readonly #reader: AdministrativeEventHistoryReader;
  public constructor(reader: AdministrativeEventHistoryReader) {
    this.#reader = reader;
    Object.freeze(this);
  }
  public execute(input?: unknown): Promise<AdministrativeEventHistoryPage> {
    return this.#reader.query(input);
  }
}
