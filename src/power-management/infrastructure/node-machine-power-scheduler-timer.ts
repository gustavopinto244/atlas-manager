import type {
  MachinePowerSchedulerTimer,
  MachinePowerSchedulerTimerHandle,
} from "../application/ports/machine-power-scheduler-timer.js";

type ScheduleTimeout = (
  callback: () => void,
  delayMilliseconds: number,
) => unknown;
type CancelTimeout = (handle: unknown) => void;

const scheduleNodeTimeout: ScheduleTimeout = (callback, delayMilliseconds) =>
  globalThis.setTimeout(callback, delayMilliseconds);

const cancelNodeTimeout: CancelTimeout = (handle) => {
  globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
};

export class NodeMachinePowerSchedulerTimer implements MachinePowerSchedulerTimer {
  readonly #scheduleTimeout: ScheduleTimeout;
  readonly #cancelTimeout: CancelTimeout;

  public constructor(
    scheduleTimeout: ScheduleTimeout = scheduleNodeTimeout,
    cancelTimeout: CancelTimeout = cancelNodeTimeout,
  ) {
    this.#scheduleTimeout = scheduleTimeout;
    this.#cancelTimeout = cancelTimeout;
    Object.freeze(this);
  }

  public schedule(
    delayMilliseconds: number,
    callback: () => void,
  ): MachinePowerSchedulerTimerHandle {
    let active = true;
    const nativeHandle = this.#scheduleTimeout(() => {
      if (!active) return;
      active = false;
      callback();
    }, delayMilliseconds);

    return Object.freeze({
      cancel: (): void => {
        if (!active) return;
        active = false;
        this.#cancelTimeout(nativeHandle);
      },
    });
  }
}
