import type { RtcInformation } from "../../domain/rtc-information.js";

export interface RtcInformationReader {
  read(observedAt: string): Promise<RtcInformation>;
}
