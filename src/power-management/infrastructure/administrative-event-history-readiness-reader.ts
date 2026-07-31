import type { AdministrativeEventHistoryReadinessReader } from "../../event-history/application/ports/administrative-event-history-reader.js";
import type { MachineShutdownEventRecordingReadinessReader } from "../application/ports/machine-shutdown-readiness-readers.js";

export class AdministrativeEventHistoryMachineShutdownReadinessReader implements MachineShutdownEventRecordingReadinessReader {
  readonly #readiness: AdministrativeEventHistoryReadinessReader;
  public constructor(readiness: AdministrativeEventHistoryReadinessReader) {
    this.#readiness = readiness;
    Object.freeze(this);
  }

  public async read() {
    const result = await this.#readiness.check();
    return result.outcome === "ready"
      ? ({ area: "event_recording", state: "ready" } as const)
      : ({
          area: "event_recording",
          state: "blocked",
          reason: "event_recording_unavailable",
        } as const);
  }
}
