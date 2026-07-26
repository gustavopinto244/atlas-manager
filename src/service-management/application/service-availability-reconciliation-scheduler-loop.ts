import type {
  ServiceAvailabilityReconciliationSchedulerTimer,
  ServiceAvailabilityReconciliationSchedulerTimerHandle,
} from "./ports/service-availability-reconciliation-scheduler-timer.js";
import type {
  RunServiceAvailabilityReconciliationSchedulerCycle,
  ServiceAvailabilityReconciliationSchedulerCycleResult,
} from "./run-service-availability-reconciliation-scheduler-cycle.js";

const CYCLE_DELAY_IN_MILLISECONDS = 60_000;

type IncompleteCycleResult = Extract<
  ServiceAvailabilityReconciliationSchedulerCycleResult,
  { kind: "incomplete" }
>;

type ConflictCycleResult = Extract<
  ServiceAvailabilityReconciliationSchedulerCycleResult,
  { kind: "conflict" }
>;

export type ServiceAvailabilityReconciliationSchedulerLoopCompletion =
  | Readonly<{
      kind: "stopped";
    }>
  | Readonly<{
      kind: "incomplete";
      cycleResult: IncompleteCycleResult;
    }>
  | Readonly<{
      kind: "conflict";
      cycleResult: ConflictCycleResult;
    }>
  | Readonly<{
      kind: "failed";
      error: unknown;
    }>;

export class ServiceAvailabilityReconciliationSchedulerLoop {
  readonly #completion: Promise<ServiceAvailabilityReconciliationSchedulerLoopCompletion>;
  readonly #resolveCompletion: (
    completion: ServiceAvailabilityReconciliationSchedulerLoopCompletion,
  ) => void;
  #started = false;
  #stopRequested = false;
  #completed = false;
  #cycleInFlight = false;
  #pendingTimer: ServiceAvailabilityReconciliationSchedulerTimerHandle | null =
    null;

  public constructor(
    private readonly runCycle: RunServiceAvailabilityReconciliationSchedulerCycle,
    private readonly timer: ServiceAvailabilityReconciliationSchedulerTimer,
  ) {
    let resolveCompletion:
      | ((
          completion: ServiceAvailabilityReconciliationSchedulerLoopCompletion,
        ) => void)
      | undefined;

    this.#completion =
      new Promise<ServiceAvailabilityReconciliationSchedulerLoopCompletion>(
        (resolve) => {
          resolveCompletion = resolve;
        },
      );
    this.#resolveCompletion = resolveCompletion!;

    Object.freeze(this);
  }

  public start(): Promise<ServiceAvailabilityReconciliationSchedulerLoopCompletion> {
    if (!this.#started && !this.#completed) {
      this.#started = true;
      this.runNextCycle();
    }

    return this.#completion;
  }

  public stop(): Promise<ServiceAvailabilityReconciliationSchedulerLoopCompletion> {
    if (this.#completed) {
      return this.#completion;
    }

    this.#stopRequested = true;

    if (!this.#started) {
      this.#started = true;
      this.complete(Object.freeze({ kind: "stopped" }));
      return this.#completion;
    }

    const pendingTimer = this.#pendingTimer;

    if (pendingTimer !== null) {
      this.#pendingTimer = null;

      try {
        pendingTimer.cancel();
      } catch (error: unknown) {
        this.complete(Object.freeze({ kind: "failed", error }));
        return this.#completion;
      }

      this.complete(Object.freeze({ kind: "stopped" }));
    } else if (!this.#cycleInFlight) {
      this.complete(Object.freeze({ kind: "stopped" }));
    }

    return this.#completion;
  }

  private runNextCycle(): void {
    if (this.#completed || this.#stopRequested || this.#cycleInFlight) {
      return;
    }

    this.#cycleInFlight = true;

    let cyclePromise: Promise<ServiceAvailabilityReconciliationSchedulerCycleResult>;

    try {
      cyclePromise = this.runCycle.execute();
    } catch (error: unknown) {
      this.#cycleInFlight = false;
      this.complete(Object.freeze({ kind: "failed", error }));
      return;
    }

    void cyclePromise.then(
      (cycleResult) => {
        this.#cycleInFlight = false;
        this.handleCycleResult(cycleResult);
      },
      (error: unknown) => {
        this.#cycleInFlight = false;
        this.complete(Object.freeze({ kind: "failed", error }));
      },
    );
  }

  private handleCycleResult(
    cycleResult: ServiceAvailabilityReconciliationSchedulerCycleResult,
  ): void {
    if (cycleResult.kind === "incomplete") {
      this.complete(
        Object.freeze({
          kind: "incomplete",
          cycleResult,
        }),
      );
      return;
    }

    if (cycleResult.kind === "conflict") {
      this.complete(
        Object.freeze({
          kind: "conflict",
          cycleResult,
        }),
      );
      return;
    }

    if (this.#stopRequested) {
      this.complete(Object.freeze({ kind: "stopped" }));
      return;
    }

    this.scheduleNextCycle();
  }

  private scheduleNextCycle(): void {
    let callbackConsumed = false;

    const callback = (): void => {
      if (callbackConsumed) {
        return;
      }

      callbackConsumed = true;
      this.#pendingTimer = null;

      if (!this.#completed && !this.#stopRequested) {
        this.runNextCycle();
      }
    };

    try {
      this.#pendingTimer = this.timer.schedule(
        CYCLE_DELAY_IN_MILLISECONDS,
        callback,
      );
    } catch (error: unknown) {
      this.complete(Object.freeze({ kind: "failed", error }));
    }
  }

  private complete(
    completion: ServiceAvailabilityReconciliationSchedulerLoopCompletion,
  ): void {
    if (this.#completed) {
      return;
    }

    this.#completed = true;
    this.#resolveCompletion(completion);
  }
}
