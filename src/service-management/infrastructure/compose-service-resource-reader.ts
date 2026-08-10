import type { ServiceResourceReader } from "../application/ports/service-resource-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceResourceObservation } from "../domain/service-resource-observation.js";
import { createUnavailableServiceResourceObservation } from "../domain/service-resource-observation.js";
import type { Clock } from "../application/ports/clock.js";

// Docker Compose resource observability needs its own aggregation design: a
// registered Compose service maps to a project with an arbitrary number of
// member containers, each with its own CPU percentage denominator, so a
// single summed value would misrepresent the project. Returning
// "unsupported" here is a deliberate placeholder for a per-member
// observation list plus a documented aggregate formula, not an oversight;
// see docs/plans/operator-dashboard-v2/03-resource-observability.md.
export class ComposeServiceResourceReader implements ServiceResourceReader {
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
