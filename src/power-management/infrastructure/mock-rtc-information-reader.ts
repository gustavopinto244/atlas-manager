import type { RtcInformationReader } from "../application/ports/rtc-information-reader.js";
import { createRtcInformation } from "../domain/rtc-information.js";
import type { RtcInformation } from "../domain/rtc-information.js";
import type { MockWakeAlarmState } from "./mock-wake-alarm-state.js";

export interface MockRtcInformationReaderConfiguration {
  readonly rtcTime: string;
  readonly failure?: Error;
}

export class MockRtcInformationReader implements RtcInformationReader {
  readonly #rtcTime: string;
  readonly #wakeAlarmState: MockWakeAlarmState;
  readonly #failure: Error | undefined;

  public constructor(
    configuration: MockRtcInformationReaderConfiguration,
    wakeAlarmState: MockWakeAlarmState,
  ) {
    const validated = createRtcInformation({
      observedAt: "1970-01-01T00:00:00.000Z",
      rtcTime: configuration.rtcTime,
      wakeAlarm: { state: "not_scheduled" },
    });
    this.#rtcTime = validated.rtcTime;
    this.#wakeAlarmState = wakeAlarmState;
    this.#failure = configuration.failure;
    Object.freeze(this);
  }

  public read(observedAt: string): Promise<RtcInformation> {
    if (this.#failure) {
      return Promise.reject(this.#failure);
    }

    return Promise.resolve(
      createRtcInformation({
        observedAt,
        rtcTime: this.#rtcTime,
        wakeAlarm: this.#wakeAlarmState.read(),
      }),
    );
  }
}
