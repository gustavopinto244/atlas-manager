import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import type {
  MachineOperatingWeekday,
  MachineWeeklyOperatingSchedule,
} from "./machine-weekly-operating-schedule.js";
import type { MachineOperatingPolicy } from "./machine-operating-policy.js";
import {
  createMachinePowerPlan,
  type MachinePowerExpectation,
  type MachinePowerPlan,
} from "./machine-power-plan.js";

const MINUTE_IN_MILLISECONDS = 60_000;
const MAXIMUM_SEARCH_IN_MILLISECONDS = 8 * 24 * 60 * MINUTE_IN_MILLISECONDS;
const LOCAL_WEEKDAY_BY_ENGLISH_NAME: Readonly<
  Record<string, MachineOperatingWeekday>
> = Object.freeze({
  Monday: "monday",
  Tuesday: "tuesday",
  Wednesday: "wednesday",
  Thursday: "thursday",
  Friday: "friday",
  Saturday: "saturday",
  Sunday: "sunday",
});

export type MachinePowerPlanEvaluationErrorCode =
  "invalid_evaluated_at" | "transition_search_exhausted";

export class MachinePowerPlanEvaluationError extends Error {
  public override readonly name = "MachinePowerPlanEvaluationError";

  public constructor(
    public readonly code: MachinePowerPlanEvaluationErrorCode,
  ) {
    super(`Unable to evaluate machine power plan: ${code}`);
    Object.freeze(this);
  }
}

export function evaluateMachinePowerPlan(
  policy: MachineOperatingPolicy,
  evaluatedAt: string,
): MachinePowerPlan {
  if (!isCanonicalTimestamp(evaluatedAt)) {
    throw new MachinePowerPlanEvaluationError("invalid_evaluated_at");
  }

  if (policy.mode === "always_on") {
    return createMachinePowerPlan({
      evaluatedAt,
      expectation: "operating",
      nextShutdown: { state: "not_planned" },
      nextWake: { state: "not_planned" },
    });
  }
  if (policy.mode === "manual") {
    return createMachinePowerPlan({
      evaluatedAt,
      expectation: "manual",
      nextShutdown: { state: "not_planned" },
      nextWake: { state: "not_planned" },
    });
  }

  return evaluateScheduledPolicy(policy, evaluatedAt);
}

function evaluateScheduledPolicy(
  policy: Extract<MachineOperatingPolicy, { readonly mode: "scheduled" }>,
  evaluatedAt: string,
): MachinePowerPlan {
  const evaluatedTimestamp = Date.parse(evaluatedAt);
  const formatter = createFormatter(policy.timezone);
  const initialExpectation = evaluateScheduledExpectation(
    policy.weeklySchedule,
    formatter,
    evaluatedTimestamp,
  );
  const transitions: readonly Transition[] = findNextTransitions(
    policy.weeklySchedule,
    formatter,
    evaluatedTimestamp,
    initialExpectation,
  );

  const first = transitions[0];
  const second = transitions[1];
  if (first === undefined || second === undefined) {
    throw new MachinePowerPlanEvaluationError("transition_search_exhausted");
  }

  if (initialExpectation === "operating") {
    return createMachinePowerPlan({
      evaluatedAt,
      expectation: initialExpectation,
      nextShutdown: { state: "planned", scheduledFor: first.scheduledFor },
      nextWake: { state: "planned", scheduledFor: second.scheduledFor },
    });
  }

  return createMachinePowerPlan({
    evaluatedAt,
    expectation: initialExpectation,
    nextShutdown: { state: "planned", scheduledFor: second.scheduledFor },
    nextWake: { state: "planned", scheduledFor: first.scheduledFor },
  });
}

interface Transition {
  readonly expectation: MachinePowerExpectation;
  readonly scheduledFor: string;
}

function findNextTransitions(
  schedule: MachineWeeklyOperatingSchedule,
  formatter: Intl.DateTimeFormat,
  evaluatedTimestamp: number,
  initialExpectation: "operating" | "offline",
): readonly Transition[] {
  const transitions: Transition[] = [];
  let previousExpectation = initialExpectation;
  const firstCandidate =
    Math.floor(evaluatedTimestamp / MINUTE_IN_MILLISECONDS) *
      MINUTE_IN_MILLISECONDS +
    MINUTE_IN_MILLISECONDS;
  const lastCandidate = evaluatedTimestamp + MAXIMUM_SEARCH_IN_MILLISECONDS;

  for (
    let candidate = firstCandidate;
    candidate <= lastCandidate;
    candidate += MINUTE_IN_MILLISECONDS
  ) {
    const expectation = evaluateScheduledExpectation(
      schedule,
      formatter,
      candidate,
    );
    if (expectation !== previousExpectation) {
      transitions.push({
        expectation,
        scheduledFor: new Date(candidate).toISOString(),
      });
      previousExpectation = expectation;
      if (transitions.length === 2) {
        return Object.freeze(transitions);
      }
    }
  }

  return Object.freeze(transitions);
}

function evaluateScheduledExpectation(
  schedule: MachineWeeklyOperatingSchedule,
  formatter: Intl.DateTimeFormat,
  timestamp: number,
): "operating" | "offline" {
  const parts = formatter.formatToParts(new Date(timestamp));
  const weekdayName = getPart(parts, "weekday");
  const dayOfWeek = LOCAL_WEEKDAY_BY_ENGLISH_NAME[weekdayName];
  const localTime = `${getPart(parts, "hour")}:${getPart(parts, "minute")}`;
  if (dayOfWeek === undefined) {
    throw new MachinePowerPlanEvaluationError("transition_search_exhausted");
  }

  const operating = schedule.windows.some(
    (window) =>
      window.dayOfWeek === dayOfWeek &&
      window.start <= localTime &&
      localTime < window.end,
  );
  return operating ? "operating" : "offline";
}

function createFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function getPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new MachinePowerPlanEvaluationError("transition_search_exhausted");
  }
  return value;
}
