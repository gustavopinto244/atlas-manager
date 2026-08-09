type Transition = Readonly<{
  state?: unknown;
  scheduledFor?: unknown;
}>;

const MACHINE_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export function renderMachinePlan(
  document: Document,
  parent: HTMLElement,
  value: unknown,
): void {
  parent.replaceChildren();
  const plan = readPlan(value);
  const summary = document.createElement("p");
  summary.textContent = `Expected state: ${plan.expectation} · Evaluated: ${plan.evaluatedAt}`;
  parent.append(summary);
  const next = findNextTransition(plan);
  const nextSummary = document.createElement("p");
  nextSummary.setAttribute("role", "status");
  nextSummary.textContent =
    next === null
      ? "Next transition: not planned"
      : `Next transition: ${next.label} at ${next.scheduledFor}`;
  parent.append(nextSummary);

  const table = document.createElement("table");
  table.className = "machine-plan";
  const head = document.createElement("thead");
  const row = document.createElement("tr");
  for (const label of ["Transition", "State", "Scheduled for"] as const) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    row.append(cell);
  }
  head.append(row);
  table.append(head);

  const body = document.createElement("tbody");
  appendTransition(document, body, "Next shutdown", plan.nextShutdown);
  appendTransition(document, body, "Next wake", plan.nextWake);
  table.append(body);
  parent.append(table);
}

export function renderMachineSchedule(
  document: Document,
  parent: HTMLElement,
  value: unknown,
): void {
  parent.replaceChildren();
  const schedule = readSchedule(value);
  const summary = document.createElement("p");
  summary.textContent = `Mode: ${schedule.mode}${schedule.timezone === null ? "" : ` · Timezone: ${schedule.timezone}`}`;
  parent.append(summary);
  if (schedule.mode === "always_on") {
    const detail = document.createElement("p");
    detail.textContent = "Operating window: all day (00:00 → 24:00).";
    parent.append(detail);
    return;
  }
  if (schedule.mode === "manual") {
    const detail = document.createElement("p");
    detail.textContent =
      "Automatic machine transitions are disabled; operator control is required.";
    parent.append(detail);
    return;
  }
  if (schedule.windows.length === 0) {
    const detail = document.createElement("p");
    detail.textContent = "No operating windows are configured.";
    parent.append(detail);
    return;
  }

  const table = document.createElement("table");
  table.className = "schedule-timeline machine-schedule";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Day", "Operating windows"] as const) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);
  const body = document.createElement("tbody");
  for (const weekday of MACHINE_WEEKDAYS) {
    const row = document.createElement("tr");
    const day = document.createElement("th");
    day.scope = "row";
    day.textContent = weekday;
    const windows = document.createElement("td");
    const values = schedule.windows
      .filter((window) => window.dayOfWeek === weekday)
      .map((window) => `${window.start} → ${window.end}`);
    windows.textContent = values.length === 0 ? "Offline" : values.join(", ");
    row.append(day, windows);
    body.append(row);
  }
  table.append(body);
  parent.append(table);
}

function appendTransition(
  document: Document,
  body: HTMLTableSectionElement,
  label: string,
  transition: Transition,
): void {
  const row = document.createElement("tr");
  for (const value of [
    label,
    readString(transition.state, "unavailable"),
    readString(transition.scheduledFor, "not planned"),
  ]) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  }
  body.append(row);
}

function findNextTransition(
  plan: Readonly<{
    nextShutdown: Transition;
    nextWake: Transition;
  }>,
): Readonly<{ label: string; scheduledFor: string }> | null {
  const candidates = [
    { label: "shutdown", transition: plan.nextShutdown },
    { label: "wake", transition: plan.nextWake },
  ].flatMap(({ label, transition }) => {
    const scheduledFor = transition.scheduledFor;
    if (
      typeof scheduledFor !== "string" ||
      Number.isNaN(Date.parse(scheduledFor))
    )
      return [];
    return [{ label, scheduledFor, timestamp: Date.parse(scheduledFor) }];
  });
  candidates.sort((left, right) => left.timestamp - right.timestamp);
  const next = candidates[0];
  return next === undefined
    ? null
    : { label: next.label, scheduledFor: next.scheduledFor };
}

function readPlan(value: unknown): Readonly<{
  evaluatedAt: string;
  expectation: string;
  nextShutdown: Transition;
  nextWake: Transition;
}> {
  if (typeof value !== "object" || value === null) return unavailablePlan();
  const record = value as Record<string, unknown>;
  return {
    evaluatedAt: readString(record.evaluatedAt, "unavailable"),
    expectation: readString(record.expectation, "unavailable"),
    nextShutdown: readTransition(record.nextShutdown),
    nextWake: readTransition(record.nextWake),
  };
}

function readTransition(value: unknown): Transition {
  return typeof value === "object" && value !== null ? value : {};
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function unavailablePlan(): Readonly<{
  evaluatedAt: string;
  expectation: string;
  nextShutdown: Transition;
  nextWake: Transition;
}> {
  return {
    evaluatedAt: "unavailable",
    expectation: "unavailable",
    nextShutdown: {},
    nextWake: {},
  };
}

function readSchedule(value: unknown): Readonly<{
  mode: string;
  timezone: string | null;
  windows: readonly Readonly<{
    dayOfWeek: string;
    start: string;
    end: string;
  }>[];
}> {
  if (typeof value !== "object" || value === null) {
    return { mode: "unavailable", timezone: null, windows: [] };
  }
  const record = value as Record<string, unknown>;
  const weeklySchedule = record.weeklySchedule;
  const rawWindows =
    typeof weeklySchedule === "object" && weeklySchedule !== null
      ? (weeklySchedule as Record<string, unknown>).windows
      : undefined;
  const windows = Array.isArray(rawWindows)
    ? rawWindows.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const window = entry as Record<string, unknown>;
        if (
          typeof window.dayOfWeek !== "string" ||
          typeof window.start !== "string" ||
          typeof window.end !== "string"
        )
          return [];
        return [
          {
            dayOfWeek: window.dayOfWeek,
            start: window.start,
            end: window.end,
          },
        ];
      })
    : [];
  return {
    mode: readString(record.mode, "unavailable"),
    timezone: typeof record.timezone === "string" ? record.timezone : null,
    windows,
  };
}
