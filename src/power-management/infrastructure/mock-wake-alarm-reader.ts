import type { WakeAlarmReader } from "../application/ports/wake-alarm-reader.js";
import { createWakeAlarmObservation } from "../domain/wake-alarm-observation.js";
import type { WakeAlarmObservation } from "../domain/wake-alarm-observation.js";
import type { MockWakeAlarmState } from "./mock-wake-alarm-state.js";

export interface MockWakeAlarmReaderConfiguration {
  readonly failure?: Error;
}

export class MockWakeAlarmReader implements WakeAlarmReader {
  readonly #state: MockWakeAlarmState;
  readonly #failure: Error | undefined;

  public constructor(
    state: MockWakeAlarmState,
    configuration: MockWakeAlarmReaderConfiguration = {},
  ) {
    this.#state = state;
    this.#failure = configuration.failure;
    Object.freeze(this);
  }

  public read(observedAt: string): Promise<WakeAlarmObservation> {
    if (this.#failure) {
      return Promise.reject(this.#failure);
    }

    return Promise.resolve(
      createWakeAlarmObservation({
        observedAt,
        wakeAlarm: this.#state.read(),
      }),
    );
  }
}
