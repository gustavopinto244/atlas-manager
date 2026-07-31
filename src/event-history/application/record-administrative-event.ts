import type {
  AdministrativeEvent,
  AdministrativeEventInput,
} from "../domain/administrative-event.js";
import type { AdministrativeEventRecorder } from "./ports/administrative-event-recorder.js";

export class RecordAdministrativeEvent {
  readonly #recorder: AdministrativeEventRecorder;
  public constructor(recorder: AdministrativeEventRecorder) {
    this.#recorder = recorder;
    Object.freeze(this);
  }
  public execute(
    input: AdministrativeEventInput,
  ): Promise<AdministrativeEvent> {
    return this.#recorder.record(input);
  }
}
