import type { MachineOperatingPolicy } from "./machine-operating-policy.js";
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "./machine-shutdown-occurrence.js";
import { isCanonicalTimestamp } from "./canonical-timestamp.js";

const MINUTE = 60_000;
const HORIZON = 8 * 24 * 60 * MINUTE;
const DAYS: Record<string, string> = Object.freeze({
  Monday: "monday",
  Tuesday: "tuesday",
  Wednesday: "wednesday",
  Thursday: "thursday",
  Friday: "friday",
  Saturday: "saturday",
  Sunday: "sunday",
});
export class MachineShutdownOccurrenceIntervalError extends Error {
  public override readonly name = "MachineShutdownOccurrenceIntervalError";
  public constructor(
    public readonly code:
      | "invalid_completed_through"
      | "invalid_ticked_through"
      | "reversed_interval"
      | "interval_too_large"
      | "search_exhausted",
  ) {
    super(`Invalid machine shutdown occurrence interval: ${code}`);
    Object.freeze(this);
  }
}

export function createMachineShutdownOccurrencesForInterval(
  policy: MachineOperatingPolicy,
  completedThrough: string,
  tickedThrough: string,
): readonly MachineShutdownOccurrence[] {
  if (!isCanonicalTimestamp(completedThrough))
    throw new MachineShutdownOccurrenceIntervalError(
      "invalid_completed_through",
    );
  if (!isCanonicalTimestamp(tickedThrough))
    throw new MachineShutdownOccurrenceIntervalError("invalid_ticked_through");
  const lower = Date.parse(completedThrough);
  const upper = Date.parse(tickedThrough);
  if (upper < lower)
    throw new MachineShutdownOccurrenceIntervalError("reversed_interval");
  if (upper - lower > HORIZON)
    throw new MachineShutdownOccurrenceIntervalError("interval_too_large");
  if (policy.mode !== "scheduled" || upper === lower) return Object.freeze([]);
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: policy.timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const occurrences: MachineShutdownOccurrence[] = [];
  const first = Math.floor(lower / MINUTE) * MINUTE + MINUTE;
  for (let candidate = first; candidate <= upper; candidate += MINUTE) {
    if (
      isOperating(policy, formatter, candidate - MINUTE) &&
      !isOperating(policy, formatter, candidate)
    ) {
      const wake = findNextOperatingStart(
        policy,
        formatter,
        candidate,
        candidate + HORIZON,
      );
      if (wake === null)
        throw new MachineShutdownOccurrenceIntervalError("search_exhausted");
      occurrences.push(
        createMachineShutdownOccurrence({
          operation: "shutdown",
          scheduledFor: new Date(candidate).toISOString(),
          wakeScheduledFor: new Date(wake).toISOString(),
        }),
      );
    }
  }
  return Object.freeze(occurrences);
}
function findNextOperatingStart(
  policy: Extract<MachineOperatingPolicy, { mode: "scheduled" }>,
  formatter: Intl.DateTimeFormat,
  from: number,
  limit: number,
): number | null {
  for (let candidate = from + MINUTE; candidate <= limit; candidate += MINUTE)
    if (
      !isOperating(policy, formatter, candidate - MINUTE) &&
      isOperating(policy, formatter, candidate)
    )
      return candidate;
  return null;
}
function isOperating(
  policy: Extract<MachineOperatingPolicy, { mode: "scheduled" }>,
  formatter: Intl.DateTimeFormat,
  timestamp: number,
): boolean {
  const parts = formatter.formatToParts(new Date(timestamp));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (weekday === undefined || hour === undefined || minute === undefined)
    return false;
  const local = `${hour}:${minute}`;
  return policy.weeklySchedule.windows.some(
    (window) =>
      window.dayOfWeek === DAYS[weekday] &&
      window.start <= local &&
      local < window.end,
  );
}
