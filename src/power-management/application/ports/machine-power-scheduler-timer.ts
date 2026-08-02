export interface MachinePowerSchedulerTimerHandle {
  cancel(): void;
}

export interface MachinePowerSchedulerTimer {
  schedule(
    delayMilliseconds: number,
    callback: () => void,
  ): MachinePowerSchedulerTimerHandle;
}
