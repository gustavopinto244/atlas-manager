export const SCHEDULE_WEEKDAYS = Object.freeze([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const);

export function renderScheduleTimeline(
  document: Document,
  parent: HTMLElement,
  value: unknown,
): void {
  parent.replaceChildren();
  const policy = readPolicy(value);
  const summary = document.createElement("p");
  summary.textContent = `Mode: ${policy.mode}${policy.timezone === null ? "" : ` · Timezone: ${policy.timezone}`}`;
  parent.append(summary);
  const effectiveAvailability = readEffectiveAvailability(value);
  if (effectiveAvailability !== null) {
    const stateLine = document.createElement("p");
    const now = new Date();
    const localTime =
      policy.timezone === null
        ? now.toISOString()
        : formatLocalTime(now, policy.timezone);
    stateLine.textContent = `Current state: ${effectiveAvailability} · Local time: ${localTime}`;
    parent.append(stateLine);
  }
  const preview = readPreview(value);
  if (preview !== null) {
    const previewSummary = document.createElement("p");
    previewSummary.textContent = `Preview: ${preview.outcome}${preview.firstRequiredAt === null ? "" : ` · First required at: ${preview.firstRequiredAt}`}`;
    parent.append(previewSummary);
    if (preview.transitions.length > 0) {
      const transitionsList = document.createElement("ul");
      transitionsList.className = "schedule-transitions";
      for (const transition of preview.transitions) {
        const item = document.createElement("li");
        const label =
          transition.kind === "became_available"
            ? "Becomes available"
            : "Becomes unavailable";
        item.textContent = `${label}: ${transition.scheduledFor}`;
        transitionsList.append(item);
      }
      parent.append(transitionsList);
    }
  }
  if (policy.mode !== "scheduled") return;
  const table = document.createElement("table");
  table.className = "schedule-timeline";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const value of ["Day", "Availability windows"] as const) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = value;
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);
  const body = document.createElement("tbody");
  for (const weekday of SCHEDULE_WEEKDAYS) {
    const row = document.createElement("tr");
    const day = document.createElement("th");
    day.scope = "row";
    day.textContent = weekday;
    const windows = document.createElement("td");
    const values = policy.windows
      .filter((window) => window.weekday === weekday)
      .map((window) => `${window.start} → ${window.end}`);
    windows.textContent = values.length === 0 ? "Offline" : values.join(", ");
    row.append(day, windows);
    body.append(row);
  }
  table.append(body);
  parent.append(table);
}

type ScheduleWindow = Readonly<{
  weekday: string;
  start: string;
  end: string;
}>;

function readPolicy(value: unknown): Readonly<{
  mode: string;
  timezone: string | null;
  windows: readonly ScheduleWindow[];
}> {
  if (typeof value !== "object" || value === null) {
    return { mode: "unavailable", timezone: null, windows: [] };
  }
  const policy = (value as { policy?: unknown }).policy;
  if (typeof policy !== "object" || policy === null) {
    return { mode: "unavailable", timezone: null, windows: [] };
  }
  const record = policy as Record<string, unknown>;
  const rawWindows = Array.isArray(record.windows) ? record.windows : [];
  const windows = rawWindows.flatMap((window): ScheduleWindow[] => {
    if (typeof window !== "object" || window === null) return [];
    const entry = window as Record<string, unknown>;
    if (
      typeof entry.weekday !== "string" ||
      typeof entry.start !== "string" ||
      typeof entry.end !== "string"
    )
      return [];
    return [{ weekday: entry.weekday, start: entry.start, end: entry.end }];
  });
  return {
    mode: typeof record.mode === "string" ? record.mode : "unavailable",
    timezone: typeof record.timezone === "string" ? record.timezone : null,
    windows,
  };
}

type ScheduleTransition = Readonly<{
  kind: "became_available" | "became_unavailable";
  scheduledFor: string;
}>;

function readPreview(value: unknown): Readonly<{
  outcome: string;
  firstRequiredAt: string | null;
  transitions: readonly ScheduleTransition[];
}> | null {
  if (typeof value !== "object" || value === null) return null;
  const preview = (value as { preview?: unknown }).preview;
  if (typeof preview !== "object" || preview === null) return null;
  const record = preview as Record<string, unknown>;
  if (typeof record.outcome !== "string") return null;
  return {
    outcome: record.outcome,
    firstRequiredAt:
      typeof record.firstRequiredAt === "string"
        ? record.firstRequiredAt
        : null,
    transitions: readTransitions(record.transitions),
  };
}

function readTransitions(value: unknown): readonly ScheduleTransition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ScheduleTransition[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (
      (record.kind !== "became_available" &&
        record.kind !== "became_unavailable") ||
      typeof record.scheduledFor !== "string"
    )
      return [];
    return [{ kind: record.kind, scheduledFor: record.scheduledFor }];
  });
}

function readEffectiveAvailability(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return typeof record.effectiveAvailability === "string"
    ? record.effectiveAvailability
    : null;
}

// The dashboard never calculates this itself -- it only formats a timestamp
// it already has (the browser clock, used purely for display) into the
// authoritative policy's own timezone, matching how an operator reading a
// weekly window would expect to see "now."
function formatLocalTime(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .format(now)
      .replace(",", "");
  } catch {
    return now.toISOString();
  }
}
