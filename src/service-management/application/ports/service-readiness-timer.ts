export interface ServiceReadinessTimer {
  sleep(milliseconds: number): Promise<void>;
}
