import type { PowerManagementClock } from "./ports/power-management-clock.js";
import type { RtcInformationReader } from "./ports/rtc-information-reader.js";
import type { RtcInformation } from "../domain/rtc-information.js";

export class GetRtcInformation {
  public constructor(
    private readonly clock: PowerManagementClock,
    private readonly reader: RtcInformationReader,
  ) {
    Object.freeze(this);
  }

  public async execute(): Promise<RtcInformation> {
    const observedAt = this.clock.now().toISOString();
    return this.reader.read(observedAt);
  }
}
