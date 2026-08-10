// Presentation of the read-only infrastructure diagnostics report
// (GET /admin/infrastructure/diagnostics, ADR-032).
//
// The dashboard never derives a diagnosis and never offers a repair: it renders
// exactly the statuses the server already computed. There is no restart,
// reload or fix control anywhere on this page, by design.

/** The dashboard's status-chip class for each diagnostic status (ADR-032). */
const CHIP_MODIFIER: Readonly<Record<string, string>> = Object.freeze({
  ok: "online",
  degraded: "degraded",
  // A definite outage reuses the existing outage chip.
  down: "unavailable",
  // "Could not determine" gets its own tone: presenting a permission gap as an
  // outage would send an operator chasing a failure that may not exist.
  unavailable: "indeterminate",
  // Intentionally off. Neutral, never alarm-adjacent.
  disabled: "disabled",
});

const CHIP_LABEL: Readonly<Record<string, string>> = Object.freeze({
  ok: "healthy",
  degraded: "degraded",
  down: "down",
  unavailable: "diagnostic unavailable",
  disabled: "intentionally disabled",
});

export function statusChipModifierForDiagnostic(status: unknown): string {
  return typeof status === "string" && status in CHIP_MODIFIER
    ? CHIP_MODIFIER[status]!
    : "indeterminate";
}

export function statusChipLabelForDiagnostic(status: unknown): string {
  return typeof status === "string" && status in CHIP_LABEL
    ? CHIP_LABEL[status]!
    : "diagnostic unavailable";
}

/**
 * Render the report.
 *
 * The dashboard half of the partial-failure obligation (ADR-032 §5.4): each
 * check is rendered in its own try-free, independent pass, so one malformed or
 * failing entry costs the operator that row and nothing else. A failing check
 * is never a failing section — whole-section `failed`/`stale` states stay
 * reserved for a rejected fetch.
 */
export function renderInfrastructureDiagnostics(
  document: Document,
  parent: HTMLElement,
  value: unknown,
): void {
  const report = asRecord(value);
  const heading = document.createElement("h3");
  heading.textContent = "Runtime diagnostics";
  parent.append(heading);

  const summary = document.createElement("p");
  const overall = readString(report?.overallStatus) ?? "unavailable";
  summary.append(document.createTextNode("Overall: "));
  summary.append(chip(document, overall));
  const generatedAt = readString(report?.generatedAt);
  if (generatedAt !== undefined)
    summary.append(document.createTextNode(` · observed ${generatedAt}`));
  parent.append(summary);

  const checks = Array.isArray(report?.checks) ? report.checks : undefined;
  if (checks === undefined) {
    const empty = document.createElement("p");
    empty.className = "field-unavailable";
    empty.textContent = "Diagnostic checks could not be read.";
    parent.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "diagnostic-checks";
  for (const entry of checks) list.append(renderCheck(document, entry));
  if (checks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "field-unavailable";
    empty.textContent = "No diagnostic checks were reported.";
    list.append(empty);
  }
  parent.append(list);

  const note = document.createElement("p");
  note.className = "field-unavailable";
  note.textContent =
    "Diagnostics are read-only. Nginx checks confirm the configuration parses, not that requests are routed correctly.";
  parent.append(note);
}

function renderCheck(document: Document, value: unknown): HTMLElement {
  const item = document.createElement("li");
  item.className = "diagnostic-check";
  const record = asRecord(value);
  const id = readString(record?.id) ?? "unknown check";
  const status = readString(record?.status) ?? "unavailable";
  const name = document.createElement("span");
  name.className = "diagnostic-check-id";
  name.textContent = id;
  item.append(name, document.createTextNode(" "), chip(document, status));

  const details: string[] = [];
  const observed = readString(record?.observed);
  const expected = readString(record?.expected);
  const hint = readString(record?.hint);
  const errorCode = readString(record?.errorCode);
  if (observed !== undefined) details.push(`observed ${observed}`);
  if (expected !== undefined) details.push(`expected ${expected}`);
  if (errorCode !== undefined) details.push(errorCode);
  // Surfaced plainly, and never turned into an offer to elevate: Atlas does
  // not escalate privilege on an operator's behalf.
  if (record?.requiresPrivilege === true)
    details.push("Atlas lacks the privilege to determine this");
  if (hint !== undefined) details.push(hint);
  if (details.length > 0) {
    const detail = document.createElement("p");
    detail.className = "diagnostic-check-detail";
    detail.textContent = details.join(" · ");
    item.append(detail);
  }
  return item;
}

function chip(document: Document, status: string): HTMLElement {
  const element = document.createElement("span");
  element.className = `status-chip status-chip--${statusChipModifierForDiagnostic(status)}`;
  element.setAttribute("aria-label", statusChipLabelForDiagnostic(status));
  element.textContent = status;
  return element;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
