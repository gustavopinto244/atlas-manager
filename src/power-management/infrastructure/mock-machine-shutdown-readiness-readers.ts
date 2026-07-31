import type {
  MachineShutdownActiveTaskReadinessReader,
  MachineShutdownBackupReadinessReader,
  MachineShutdownConfirmationReader,
  MachineShutdownEventRecordingReadinessReader,
  MachineShutdownFilesystemReadinessReader,
  MachineShutdownServiceReadinessReader,
  MachineReadinessState,
} from "../application/ports/machine-shutdown-readiness-readers.js";
import type { MachineShutdownOccurrence } from "../domain/machine-shutdown-occurrence.js";
import type { MachineShutdownReadinessBlocker } from "../domain/machine-shutdown-readiness-blocker.js";

export class MockMachineShutdownConfirmationReader implements MachineShutdownConfirmationReader {
  readonly #result: "confirmed" | "not_confirmed";
  readonly #failure?: Error;
  public constructor(
    result: "confirmed" | "not_confirmed" = "not_confirmed",
    failure?: Error,
  ) {
    this.#result = result;
    if (failure) this.#failure = failure;
    Object.freeze(this);
  }
  public read(
    _occurrence: MachineShutdownOccurrence,
    _evaluatedAt: string,
  ): Promise<"confirmed" | "not_confirmed"> {
    void _occurrence;
    void _evaluatedAt;
    return this.#failure
      ? Promise.reject(this.#failure)
      : Promise.resolve(this.#result);
  }
}

export class MockMachineShutdownReadinessReader
  implements
    MachineShutdownActiveTaskReadinessReader,
    MachineShutdownBackupReadinessReader,
    MachineShutdownFilesystemReadinessReader,
    MachineShutdownEventRecordingReadinessReader
{
  readonly #result: MachineReadinessState;
  readonly #failure?: Error;
  public constructor(result: MachineReadinessState, failure?: Error) {
    this.#result = result;
    if (failure) this.#failure = failure;
    Object.freeze(this);
  }
  public read(
    _occurrence: MachineShutdownOccurrence,
    _evaluatedAt: string,
  ): Promise<MachineReadinessState> {
    void _occurrence;
    void _evaluatedAt;
    return this.#failure
      ? Promise.reject(this.#failure)
      : Promise.resolve(this.#result);
  }
}

type ServiceResult =
  | Readonly<{ state: "ready"; blockers: readonly [] }>
  | Readonly<{
      state: "blocked";
      blockers: readonly MachineShutdownReadinessBlocker[];
    }>;
export class MockMachineShutdownServiceReadinessReader implements MachineShutdownServiceReadinessReader {
  readonly #result: ServiceResult;
  readonly #failure?: Error;
  public constructor(
    result: ServiceResult = {
      state: "blocked",
      blockers: [{ area: "services", code: "service_readiness_unavailable" }],
    },
    failure?: Error,
  ) {
    this.#result = result;
    if (failure) this.#failure = failure;
    Object.freeze(this);
  }
  public read(
    _occurrence: MachineShutdownOccurrence,
    _evaluatedAt: string,
  ): Promise<ServiceResult> {
    void _occurrence;
    void _evaluatedAt;
    return this.#failure
      ? Promise.reject(this.#failure)
      : Promise.resolve(this.#result);
  }
}
