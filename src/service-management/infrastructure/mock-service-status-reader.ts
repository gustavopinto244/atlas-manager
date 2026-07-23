import type { ServiceStatusReader } from "../application/ports/service-status-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import {
  SERVICE_RUNTIME_STATES,
  type ServiceRuntimeState,
} from "../domain/registered-service-status.js";

export interface MockServiceStatusConfiguration {
  readonly externalResourceId: string;
  readonly state: string;
}

export type MockServiceStatusReaderErrorCode =
  | "invalid_mock_status_state"
  | "duplicate_mock_status_target"
  | "unsupported_status_adapter"
  | "service_status_unavailable";

export class MockServiceStatusReaderError extends Error {
  public override readonly name = "MockServiceStatusReaderError";

  public constructor(public readonly code: MockServiceStatusReaderErrorCode) {
    super(`Mock service status error: ${code}`);
  }
}

export class MockServiceStatusReader implements ServiceStatusReader {
  private constructor(
    private readonly statesByExternalResource: ReadonlyMap<
      string,
      ServiceRuntimeState
    >,
  ) {
    Object.freeze(this);
  }

  public static create(
    configuration: readonly MockServiceStatusConfiguration[],
  ): MockServiceStatusReader {
    const statesByExternalResource = new Map<string, ServiceRuntimeState>();
    const runtimeStateAllowlist = new Set<string>(SERVICE_RUNTIME_STATES);

    for (const entry of configuration) {
      if (!runtimeStateAllowlist.has(entry.state)) {
        throw new MockServiceStatusReaderError("invalid_mock_status_state");
      }

      if (statesByExternalResource.has(entry.externalResourceId)) {
        throw new MockServiceStatusReaderError("duplicate_mock_status_target");
      }

      statesByExternalResource.set(
        entry.externalResourceId,
        entry.state as ServiceRuntimeState,
      );
    }

    return new MockServiceStatusReader(statesByExternalResource);
  }

  public read(service: RegisteredService): Promise<ServiceRuntimeState> {
    if (service.managementAdapter !== "mock") {
      return Promise.reject(
        new MockServiceStatusReaderError("unsupported_status_adapter"),
      );
    }

    const state = this.statesByExternalResource.get(service.externalResourceId);

    if (state === undefined) {
      return Promise.reject(
        new MockServiceStatusReaderError("service_status_unavailable"),
      );
    }

    return Promise.resolve(state);
  }
}
