type Transition = Readonly<{
  state?: unknown;
  scheduledFor?: unknown;
}>;

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
  return typeof value === "object" && value !== null
    ? (value as Transition)
    : {};
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
