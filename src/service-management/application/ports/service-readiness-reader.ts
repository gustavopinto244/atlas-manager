import type { RegisteredService } from "../../domain/registered-service.js";

export type ServiceReadinessState = "ready" | "not_ready";

export interface ServiceReadinessResult {
  readonly serviceId: string;
  readonly observedAt: string;
  readonly state: ServiceReadinessState;
}

export interface ServiceReadinessReader {
  check(service: RegisteredService): Promise<ServiceReadinessResult>;
}
