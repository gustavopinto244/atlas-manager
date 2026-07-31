import type { RtcInformationReader } from "../application/ports/rtc-information-reader.js";
import {
  createRtcInformation,
  type RtcInformation,
} from "../domain/rtc-information.js";

export interface MockRtcInformationReaderConfiguration {
  readonly rtcTime: string;
  readonly wakeAlarm: unknown;
  readonly failure?: Error;
}

export class MockRtcInformationReader implements RtcInformationReader {
  readonly #rtcTime: string;
  readonly #wakeAlarm: RtcInformation["wakeAlarm"];
  readonly #failure: Error | undefined;

  public constructor(configuration: MockRtcInformationReaderConfiguration) {
    const validated = createRtcInformation({
      observedAt: "1970-01-01T00:00:00.000Z",
      rtcTime: configuration.rtcTime,
      wakeAlarm: configuration.wakeAlarm,
    });
    this.#rtcTime = validated.rtcTime;
    this.#wakeAlarm = validated.wakeAlarm;
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
        wakeAlarm: this.#wakeAlarm,
      }),
    );
  }
}
