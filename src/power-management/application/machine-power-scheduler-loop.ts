import type { MachinePowerSchedulerResult } from "../domain/machine-power-scheduler-result.js";
import type {
  MachinePowerSchedulerTimer,
  MachinePowerSchedulerTimerHandle,
} from "./ports/machine-power-scheduler-timer.js";

const MACHINE_POWER_SCHEDULER_DELAY = 60_000;

export type MachinePowerSchedulerLoopCompletion =
  | Readonly<{ kind: "stopped" }>
  | Readonly<{ kind: "blocked"; tickResult: MachinePowerSchedulerResult }>
  | Readonly<{ kind: "incomplete"; tickResult: MachinePowerSchedulerResult }>
  | Readonly<{ kind: "conflict"; tickResult: MachinePowerSchedulerResult }>
  | Readonly<{ kind: "failed"; error: unknown }>;

export interface MachinePowerSchedulerTick {
  execute(): Promise<MachinePowerSchedulerResult>;
}

export class MachinePowerSchedulerLoop {
  readonly #completion: Promise<MachinePowerSchedulerLoopCompletion>;
  readonly #resolveCompletion: (
    completion: MachinePowerSchedulerLoopCompletion,
  ) => void;
  #started = false;
  #stopRequested = false;
  #completed = false;
  #tickInFlight = false;
  #pendingTimer: MachinePowerSchedulerTimerHandle | null = null;

  public constructor(
    private readonly tick: MachinePowerSchedulerTick,
    private readonly timer: MachinePowerSchedulerTimer,
  ) {
    let resolveCompletion:
      ((completion: MachinePowerSchedulerLoopCompletion) => void) | undefined;
    this.#completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    this.#resolveCompletion = resolveCompletion!;
    Object.freeze(this);
  }

  public start(): Promise<MachinePowerSchedulerLoopCompletion> {
    if (!this.#started && !this.#completed) {
      this.#started = true;
      this.runNextTick();
    }
    return this.#completion;
  }

  public stop(): Promise<MachinePowerSchedulerLoopCompletion> {
    if (this.#completed) return this.#completion;
    this.#stopRequested = true;

    if (!this.#started) {
      this.#started = true;
      this.complete({ kind: "stopped" });
      return this.#completion;
    }

    if (this.#pendingTimer !== null) {
      const pendingTimer = this.#pendingTimer;
      this.#pendingTimer = null;
      try {
        pendingTimer.cancel();
      } catch (error: unknown) {
        this.complete({ kind: "failed", error });
        return this.#completion;
      }
      this.complete({ kind: "stopped" });
    } else if (!this.#tickInFlight) {
      this.complete({ kind: "stopped" });
    }
    return this.#completion;
  }

  private runNextTick(): void {
    if (this.#completed || this.#stopRequested || this.#tickInFlight) return;
    this.#tickInFlight = true;

    let tickPromise: Promise<MachinePowerSchedulerResult>;
    try {
      tickPromise = this.tick.execute();
    } catch (error: unknown) {
      this.#tickInFlight = false;
      this.complete({ kind: "failed", error });
      return;
    }

    void tickPromise.then(
      (result) => {
        this.#tickInFlight = false;
        this.handleTickResult(result);
      },
      (error: unknown) => {
        this.#tickInFlight = false;
        this.complete({ kind: "failed", error });
      },
    );
  }

  private handleTickResult(result: MachinePowerSchedulerResult): void {
    if (!isMachinePowerSchedulerResult(result)) {
      this.complete({
        kind: "failed",
        error: new Error("invalid_tick_result"),
      });
      return;
    }
    if (result.kind === "blocked") {
      this.complete({ kind: "blocked", tickResult: result });
      return;
    }
    if (result.kind === "incomplete") {
      this.complete({ kind: "incomplete", tickResult: result });
      return;
    }
    if (result.kind === "conflict") {
      this.complete({ kind: "conflict", tickResult: result });
      return;
    }
    if (this.#stopRequested) {
      this.complete({ kind: "stopped" });
      return;
    }
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    let callbackConsumed = false;
    const callback = (): void => {
      if (callbackConsumed) return;
      callbackConsumed = true;
      this.#pendingTimer = null;
      if (!this.#completed && !this.#stopRequested) this.runNextTick();
    };
    try {
      this.#pendingTimer = this.timer.schedule(
        MACHINE_POWER_SCHEDULER_DELAY,
        callback,
      );
    } catch (error: unknown) {
      this.complete({ kind: "failed", error });
    }
  }

  private complete(completion: MachinePowerSchedulerLoopCompletion): void {
    if (this.#completed) return;
    this.#completed = true;
    this.#resolveCompletion(Object.freeze(completion));
  }
}

function isMachinePowerSchedulerResult(
  value: unknown,
): value is MachinePowerSchedulerResult {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const kind = (value as Record<string, unknown>).kind;
  return (
    kind === "initialized" ||
    kind === "idle" ||
    kind === "advanced" ||
    kind === "blocked" ||
    kind === "incomplete" ||
    kind === "conflict"
  );
}
