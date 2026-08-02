import type {
  MachinePowerSchedulerLoop,
  MachinePowerSchedulerLoopCompletion,
} from "../power-management/application/machine-power-scheduler-loop.js";
import {
  logMachinePowerSchedulerObserverFailed,
  logMachinePowerSchedulerStarted,
  logMachinePowerSchedulerStopped,
  logMachinePowerSchedulerTerminated,
  type SchedulerRuntimeLogger,
} from "../logging/logger.js";
import type {
  ApplicationShutdownReason,
  RequestShutdown,
} from "./graceful-shutdown.js";

export class MachinePowerSchedulerRuntime {
  #completion: Promise<MachinePowerSchedulerLoopCompletion> | undefined;
  #failureExitCodeRequested = false;

  public constructor(
    private readonly schedulerLoop: MachinePowerSchedulerLoop,
    private readonly requestShutdown: RequestShutdown,
    private readonly logger: SchedulerRuntimeLogger,
    private readonly setFailureExitCode: () => void,
  ) {
    Object.freeze(this);
  }

  public start(): Promise<MachinePowerSchedulerLoopCompletion> {
    if (this.#completion !== undefined) return this.#completion;
    const completion = this.schedulerLoop.start();
    this.#completion = completion;
    logMachinePowerSchedulerStarted(this.logger);
    void completion.then(
      (result) => this.observeCompletion(result),
      (error: unknown) => {
        logMachinePowerSchedulerTerminated(this.logger, {
          outcome: "failed",
          errorType: getErrorType(error),
        });
        this.requestFailureExitCode();
        this.requestApplicationShutdown("machine_power_scheduler_failed");
      },
    );
    return completion;
  }

  private observeCompletion(
    completion: MachinePowerSchedulerLoopCompletion,
  ): void {
    if (completion.kind === "stopped") {
      logMachinePowerSchedulerStopped(this.logger);
      return;
    }

    logMachinePowerSchedulerTerminated(this.logger, {
      outcome: completion.kind,
      ...(completion.kind === "failed"
        ? { errorType: getErrorType(completion.error) }
        : {}),
    });
    this.requestFailureExitCode();
    this.requestApplicationShutdown(mapShutdownReason(completion.kind));
  }

  private requestApplicationShutdown(
    kind: Exclude<ApplicationShutdownReason["kind"], "signal">,
  ): void {
    let shutdownPromise: Promise<void>;
    try {
      shutdownPromise = this.requestShutdown(Object.freeze({ kind }));
    } catch (error: unknown) {
      this.handleObserverFailure(error);
      return;
    }
    void shutdownPromise.catch((error: unknown) => {
      this.handleObserverFailure(error);
    });
  }

  private handleObserverFailure(error: unknown): void {
    logMachinePowerSchedulerObserverFailed(this.logger, error);
    this.requestFailureExitCode();
  }

  private requestFailureExitCode(): void {
    if (this.#failureExitCodeRequested) return;
    this.#failureExitCodeRequested = true;
    this.setFailureExitCode();
  }
}

function mapShutdownReason(
  kind:
    | Exclude<MachinePowerSchedulerLoopCompletion["kind"], "stopped" | "failed">
    | "failed",
): Exclude<ApplicationShutdownReason["kind"], "signal"> {
  return `machine_power_scheduler_${kind}` as Exclude<
    ApplicationShutdownReason["kind"],
    "signal"
  >;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
