export interface ServiceAvailabilityReconciliationSchedulerTimerHandle {
  cancel(): void;
}

export interface ServiceAvailabilityReconciliationSchedulerTimer {
  schedule(
    delayMilliseconds: number,
    callback: () => void,
  ): ServiceAvailabilityReconciliationSchedulerTimerHandle;
}
