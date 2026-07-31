import type { AdministrativeEventAttemptIdGenerator } from "../application/ports/administrative-event-attempt-id-generator.js";

export class InMemoryAdministrativeEventAttemptIdGenerator implements AdministrativeEventAttemptIdGenerator {
  readonly #ids: readonly string[];
  #index = 0;

  public constructor(ids: readonly string[]) {
    this.#ids = Object.freeze([...ids]);
    Object.freeze(this);
  }

  public generate(): string {
    const value = this.#ids[this.#index];
    if (!value)
      throw new Error("No deterministic administrative attempt ID remains");
    this.#index += 1;
    return value;
  }
}
