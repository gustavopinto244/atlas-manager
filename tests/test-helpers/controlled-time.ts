import type { Clock } from "../../src/service-management/application/ports/clock.js";
import type { ServiceReadinessTimer } from "../../src/service-management/application/ports/service-readiness-timer.js";
import type {
  ServiceReadinessReader,
  ServiceReadinessResult,
} from "../../src/service-management/application/ports/service-readiness-reader.js";

export interface ControlledTime {
  readonly clock: Clock;
  readonly timer: ServiceReadinessTimer;
  readonly now: () => Date;
  readonly advance: (milliseconds: number) => void;
}

export function createControlledTime(initialInstant: Date): ControlledTime {
  let currentInstant = new Date(initialInstant.getTime());

  const clock: Clock = Object.freeze({
    now: () => new Date(currentInstant.getTime()),
  });

  const timer: ServiceReadinessTimer = Object.freeze({
    async sleep(milliseconds: number): Promise<void> {
      if (!Number.isInteger(milliseconds) || milliseconds < 1) {
        throw new Error(`Invalid sleep duration: ${milliseconds}`);
      }
      currentInstant = new Date(currentInstant.getTime() + milliseconds);
    },
  });

  return Object.freeze({
    clock,
    timer,
    now: () => new Date(currentInstant.getTime()),
    advance: (milliseconds: number) => {
      if (!Number.isInteger(milliseconds) || milliseconds < 1) {
        throw new Error(`Invalid advance duration: ${milliseconds}`);
      }
      currentInstant = new Date(currentInstant.getTime() + milliseconds);
    },
  });
}

export interface SequenceClock extends Clock {
  readonly calls: number;
}

export function createSequenceClock(values: readonly Date[]): SequenceClock {
  const remaining = [...values];
  let callCount = 0;

  const now = (): Date => {
    callCount++;
    const value = remaining.shift();
    if (value === undefined) {
      throw new Error("Controlled sequence clock was exhausted");
    }
    return new Date(value.getTime());
  };

  return Object.freeze({
    now,
    get calls() {
      return callCount;
    },
  });
}

export interface SequenceReadinessReader extends ServiceReadinessReader {
  readonly calls: number;
}

export function createSequenceReadinessReader(
  serviceId: string,
  states: ReadonlyArray<"ready" | "not_ready">,
): SequenceReadinessReader {
  const remaining = [...states];
  let callCount = 0;

  const check = async (): Promise<ServiceReadinessResult> => {
    callCount++;
    const state = remaining.shift();
    if (state === undefined) {
      throw new Error("Readiness sequence was exhausted");
    }
    return Object.freeze({
      serviceId,
      observedAt: new Date().toISOString(),
      state,
    });
  };

  return Object.freeze({
    check,
    get calls() {
      return callCount;
    },
  });
}
