export interface BackupSchedulerLoopCompletion {
  readonly kind: "stopped";
}

export class BackupSchedulerLoop {
  readonly #tick: () => Promise<unknown>;
  readonly #intervalMs = 60_000;
  #timer: NodeJS.Timeout | undefined;
  #completion: Promise<BackupSchedulerLoopCompletion> | undefined;
  #resolve: ((value: BackupSchedulerLoopCompletion) => void) | undefined;

  public constructor(tick: () => Promise<unknown>) {
    this.#tick = tick;
    Object.freeze(this);
  }

  public start(): Promise<BackupSchedulerLoopCompletion> {
    if (this.#completion !== undefined) return this.#completion;
    this.#completion = new Promise((resolve) => {
      this.#resolve = resolve;
    });
    this.#timer = setInterval(() => {
      void this.#runTick();
    }, this.#intervalMs);
    this.#timer.unref();
    return this.#completion;
  }

  public stop(): Promise<void> {
    if (this.#timer === undefined) return Promise.resolve();
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#resolve?.({ kind: "stopped" });
    this.#resolve = undefined;
    return Promise.resolve();
  }

  async #runTick(): Promise<void> {
    try {
      await this.#tick();
    } catch {
      /* one failed tick is isolated until the next fixed tick */
    }
  }
}
