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
  const preview = readPreview(value);
  if (preview !== null) {
    const previewSummary = document.createElement("p");
    previewSummary.textContent = `Preview: ${preview.outcome}${preview.firstRequiredAt === null ? "" : ` · First required at: ${preview.firstRequiredAt}`}`;
    parent.append(previewSummary);
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

function readPreview(value: unknown): Readonly<{
  outcome: string;
  firstRequiredAt: string | null;
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
  };
}
