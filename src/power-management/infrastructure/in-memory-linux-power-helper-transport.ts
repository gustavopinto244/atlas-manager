import type { LinuxPowerHelperTransport } from "../application/ports/linux-power-helper-transport.js";
import {
  createLinuxPowerHelperRequest,
  type LinuxPowerHelperOperation,
  type LinuxPowerHelperRequest,
  type LinuxPowerHelperResponse,
} from "../domain/linux-power-helper-protocol.js";
import {
  createWakeAlarmState,
  type WakeAlarmState,
} from "../domain/wake-alarm-state.js";
import { createWakeAlarmMutationResult } from "../domain/wake-alarm-mutation-result.js";

export interface InMemoryLinuxPowerHelperTransportConfiguration {
  readonly initialWakeAlarm?: unknown;
  readonly rtcTime?: string;
  readonly responseByOperation?: Partial<
    Record<LinuxPowerHelperOperation, unknown>
  >;
  readonly failure?: Error;
  readonly failureByOperation?: Partial<
    Record<LinuxPowerHelperOperation, Error>
  >;
}

export class InMemoryLinuxPowerHelperTransport implements LinuxPowerHelperTransport {
  readonly #rtcTime: string;
  readonly #responseByOperation: Partial<
    Record<LinuxPowerHelperOperation, unknown>
  >;
  readonly #failure: Error | undefined;
  readonly #failureByOperation: Partial<
    Record<LinuxPowerHelperOperation, Error>
  >;
  #wakeAlarm: WakeAlarmState;
  readonly #invocations: LinuxPowerHelperRequest[] = [];

  public constructor(
    configuration: InMemoryLinuxPowerHelperTransportConfiguration = {},
  ) {
    this.#rtcTime = configuration.rtcTime ?? "2026-01-01T00:00:00.000Z";
    this.#wakeAlarm = createWakeAlarmState(
      configuration.initialWakeAlarm ?? { state: "not_scheduled" },
    );
    this.#responseByOperation = { ...configuration.responseByOperation };
    this.#failure = configuration.failure;
    this.#failureByOperation = { ...configuration.failureByOperation };
    Object.freeze(this);
  }

  public get invocations(): readonly LinuxPowerHelperRequest[] {
    return Object.freeze(
      this.#invocations.map((request) =>
        createLinuxPowerHelperRequest(request),
      ),
    );
  }

  public execute(
    request: LinuxPowerHelperRequest,
  ): Promise<LinuxPowerHelperResponse> {
    const validated = createLinuxPowerHelperRequest(request);
    this.#invocations.push(validated);
    const failure =
      this.#failureByOperation[validated.operation] ?? this.#failure;
    if (failure) return Promise.reject(failure);

    const configured = this.#responseByOperation[validated.operation];
    if (configured !== undefined) {
      return Promise.resolve(configured as LinuxPowerHelperResponse);
    }

    return Promise.resolve(this.#createDefaultResponse(validated));
  }

  #createDefaultResponse(
    request: LinuxPowerHelperRequest,
  ): LinuxPowerHelperResponse {
    if (request.operation === "read_rtc_information") {
      return Object.freeze({
        version: 1,
        operation: request.operation,
        outcome: "success",
        result: Object.freeze({
          rtcTime: this.#rtcTime,
          wakeAlarm: this.#wakeAlarm,
        }),
      });
    }
    if (request.operation === "read_wake_alarm") {
      return Object.freeze({
        version: 1,
        operation: request.operation,
        outcome: "success",
        result: this.#wakeAlarm,
      });
    }
    if (request.operation === "request_shutdown") {
      return Object.freeze({
        version: 1,
        operation: request.operation,
        outcome: "success",
        result: Object.freeze({ accepted: true as const }),
      });
    }
    const before = this.#wakeAlarm;
    const after =
      request.operation === "schedule_wake_alarm"
        ? createWakeAlarmState({
            state: "scheduled",
            scheduledFor: request.scheduledFor,
          })
        : createWakeAlarmState({ state: "not_scheduled" });
    const outcome =
      request.operation === "schedule_wake_alarm"
        ? before.state === "not_scheduled"
          ? "scheduled"
          : before.state === "scheduled" &&
              before.scheduledFor === request.scheduledFor
            ? "unchanged"
            : "replaced"
        : before.state === "scheduled"
          ? "cancelled"
          : "not_scheduled";
    const mutation = createWakeAlarmMutationResult({
      operation:
        request.operation === "schedule_wake_alarm" ? "schedule" : "cancel",
      requestedAt: request.requestedAt,
      outcome,
      before,
      after,
    });
    this.#wakeAlarm = mutation.after;
    return Object.freeze({
      version: 1,
      operation: request.operation,
      outcome: "success",
      result: Object.freeze({
        before: mutation.before,
        after: mutation.after,
        outcome: mutation.outcome,
      }),
    });
  }
}
