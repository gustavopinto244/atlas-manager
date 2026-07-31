import type { WakeAlarmController } from "../application/ports/wake-alarm-controller.js";
import type { WakeAlarmMutationResult } from "../domain/wake-alarm-mutation-result.js";
import type { MockWakeAlarmState } from "./mock-wake-alarm-state.js";

export interface MockWakeAlarmControllerConfiguration {
  readonly scheduleFailure?: Error;
  readonly cancelFailure?: Error;
}

export class MockWakeAlarmController implements WakeAlarmController {
  readonly #state: MockWakeAlarmState;
  readonly #scheduleFailure: Error | undefined;
  readonly #cancelFailure: Error | undefined;

  public constructor(
    state: MockWakeAlarmState,
    configuration: MockWakeAlarmControllerConfiguration = {},
  ) {
    this.#state = state;
    this.#scheduleFailure = configuration.scheduleFailure;
    this.#cancelFailure = configuration.cancelFailure;
    Object.freeze(this);
  }

  public schedule(
    requestedAt: string,
    scheduledFor: string,
  ): Promise<WakeAlarmMutationResult> {
    if (this.#scheduleFailure) {
      return Promise.reject(this.#scheduleFailure);
    }
    return Promise.resolve().then(() =>
      this.#state.schedule(requestedAt, scheduledFor),
    );
  }

  public cancel(requestedAt: string): Promise<WakeAlarmMutationResult> {
    if (this.#cancelFailure) {
      return Promise.reject(this.#cancelFailure);
    }
    return Promise.resolve().then(() => this.#state.cancel(requestedAt));
  }
}
