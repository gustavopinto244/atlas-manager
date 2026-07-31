import { UnsupportedWakeAlarmMutationError } from "../domain/wake-alarm-errors.js";
import {
  createWakeAlarmMutationResult,
  type WakeAlarmMutationResult,
} from "../domain/wake-alarm-mutation-result.js";
import {
  createWakeAlarmState,
  type WakeAlarmState,
} from "../domain/wake-alarm-state.js";

export interface MockWakeAlarmStateConfiguration {
  readonly initialWakeAlarm?: unknown;
}

const DEFAULT_WAKE_ALARM = Object.freeze({ state: "not_scheduled" as const });

export class MockWakeAlarmState {
  #wakeAlarm: WakeAlarmState;

  public constructor(configuration: MockWakeAlarmStateConfiguration = {}) {
    this.#wakeAlarm = createWakeAlarmState(
      configuration.initialWakeAlarm ?? DEFAULT_WAKE_ALARM,
    );
    Object.freeze(this);
  }

  public read(): WakeAlarmState {
    return createWakeAlarmState(this.#wakeAlarm);
  }

  public schedule(
    requestedAt: string,
    scheduledFor: string,
  ): WakeAlarmMutationResult {
    const before = this.read();
    if (before.state === "unsupported") {
      throw new UnsupportedWakeAlarmMutationError();
    }

    const after = createWakeAlarmState({ state: "scheduled", scheduledFor });
    if (!isScheduled(after)) {
      throw new Error("Mock wake-alarm state produced an invalid schedule");
    }
    let outcome: "scheduled" | "replaced" | "unchanged";
    if (isScheduled(before)) {
      outcome =
        before.scheduledFor === after.scheduledFor ? "unchanged" : "replaced";
    } else {
      outcome = "scheduled";
    }
    const result = createWakeAlarmMutationResult({
      operation: "schedule",
      requestedAt,
      outcome,
      before,
      after,
    });
    this.#wakeAlarm = result.after;
    return result;
  }

  public cancel(requestedAt: string): WakeAlarmMutationResult {
    const before = this.read();
    if (before.state === "unsupported") {
      throw new UnsupportedWakeAlarmMutationError();
    }

    const after =
      before.state === "scheduled"
        ? createWakeAlarmState({ state: "not_scheduled" })
        : before;
    const outcome =
      before.state === "scheduled" ? "cancelled" : "not_scheduled";
    const result = createWakeAlarmMutationResult({
      operation: "cancel",
      requestedAt,
      outcome,
      before,
      after,
    });
    this.#wakeAlarm = result.after;
    return result;
  }
}

function isScheduled(
  state: WakeAlarmState,
): state is Extract<WakeAlarmState, { readonly state: "scheduled" }> {
  return state.state === "scheduled";
}
