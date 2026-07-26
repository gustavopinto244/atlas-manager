import type {
  ServiceAvailabilityReconciliationSchedulerLoop,
  ServiceAvailabilityReconciliationSchedulerLoopCompletion,
} from "../service-management/application/service-availability-reconciliation-scheduler-loop.js";
import {
  logServiceAvailabilityReconciliationSchedulerObserverFailed,
  logServiceAvailabilityReconciliationSchedulerStarted,
  logServiceAvailabilityReconciliationSchedulerStopped,
  logServiceAvailabilityReconciliationSchedulerTerminated,
  type SchedulerRuntimeLogger,
} from "../logging/logger.js";
import type {
  ApplicationShutdownReason,
  RequestShutdown,
} from "./graceful-shutdown.js";

export class ServiceAvailabilityReconciliationSchedulerRuntime {
  #completion:
    | Promise<ServiceAvailabilityReconciliationSchedulerLoopCompletion>
    | undefined;
  #failureExitCodeRequested = false;

  public constructor(
    private readonly schedulerLoop: ServiceAvailabilityReconciliationSchedulerLoop,
    private readonly requestShutdown: RequestShutdown,
    private readonly logger: SchedulerRuntimeLogger,
    private readonly setFailureExitCode: () => void,
  ) {
    Object.freeze(this);
  }

  public start(): Promise<ServiceAvailabilityReconciliationSchedulerLoopCompletion> {
    if (this.#completion !== undefined) {
      return this.#completion;
    }

    const completion = this.schedulerLoop.start();
    this.#completion = completion;
    logServiceAvailabilityReconciliationSchedulerStarted(this.logger);
    void completion.then(
      (result) => {
        this.observeCompletion(result);
      },
      (error: unknown) => {
        logServiceAvailabilityReconciliationSchedulerTerminated(this.logger, {
          outcome: "failed",
          errorType: getErrorType(error),
        });
        this.requestFailureExitCode();
        this.requestApplicationShutdown("scheduler_failed");
      },
    );

    return completion;
  }

  private observeCompletion(
    completion: ServiceAvailabilityReconciliationSchedulerLoopCompletion,
  ): void {
    if (completion.kind === "stopped") {
      logServiceAvailabilityReconciliationSchedulerStopped(this.logger);
      return;
    }

    if (completion.kind === "failed") {
      logServiceAvailabilityReconciliationSchedulerTerminated(this.logger, {
        outcome: completion.kind,
        errorType: getErrorType(completion.error),
      });
    } else {
      logServiceAvailabilityReconciliationSchedulerTerminated(this.logger, {
        outcome: completion.kind,
      });
    }

    this.requestFailureExitCode();
    this.requestApplicationShutdown(`scheduler_${completion.kind}`);
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
    logServiceAvailabilityReconciliationSchedulerObserverFailed(
      this.logger,
      error,
    );
    this.requestFailureExitCode();
  }

  private requestFailureExitCode(): void {
    if (this.#failureExitCodeRequested) {
      return;
    }

    this.#failureExitCodeRequested = true;
    this.setFailureExitCode();
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
