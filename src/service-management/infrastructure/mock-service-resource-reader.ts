import type { ServiceResourceReader } from "../application/ports/service-resource-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceResourceObservation } from "../domain/service-resource-observation.js";
import { createUnavailableServiceResourceObservation } from "../domain/service-resource-observation.js";
import type { Clock } from "../application/ports/clock.js";

// The mock adapter exists for tests and demonstrations, not for a real
// managed process; it has no resource usage to observe.
export class MockServiceResourceReader implements ServiceResourceReader {
  public constructor(private readonly clock: Clock) {
    Object.freeze(this);
  }

  public read(service: RegisteredService): Promise<ServiceResourceObservation> {
    void service;
    return Promise.resolve(
      createUnavailableServiceResourceObservation(
        this.clock.now().toISOString(),
        "unsupported",
      ),
    );
  }
}
