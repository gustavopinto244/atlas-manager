// Presentation and mutation for the Settings page.
//
// Settings intentionally exposes exactly one administrable item today: the
// event-history retention policy (GET/PUT /admin/event-history/retention).
// That route already carries a typed contract, RBAC (`event_history.retention.write`),
// server-side bounds validation, audit logging and a confirmation gate
// (`confirm_administrative_event_history_retention_update`) -- see
// docs/reviews/operator-experience-settings-audit.md for the full audit of
// what was and was not judged administrable. This module adds no new backend
// behavior; it only gives the existing contract a dashboard form, following
// the same fetch/confirm/reread shape used by the weekly schedule editor and
// the backup policy forms in `main.ts`.

export type EventHistoryRetentionPolicyInput = Readonly<{
  automaticPruneEnabled: boolean;
  minSealedSegments: number;
  maxSealedSegments: number;
  maxSealedSegmentAgeDays: number;
  minExports: number;
  maxExports: number;
  maxExportAgeDays: number;
}>;

const DEFAULT_POLICY_INPUT: EventHistoryRetentionPolicyInput = Object.freeze({
  automaticPruneEnabled: false,
  minSealedSegments: 1,
  maxSealedSegments: 100,
  maxSealedSegmentAgeDays: 365,
  minExports: 0,
  maxExports: 32,
  maxExportAgeDays: 90,
});

/**
 * Parses a GET /admin/event-history/retention response (or a raw
 * EventHistoryRetentionPolicy, as returned by the PUT response) into editor
 * field values. Falls back to the documented server default
 * (DEFAULT_EVENT_HISTORY_RETENTION_POLICY in
 * src/event-history/domain/event-history-record.ts) for any field that is
 * missing or malformed, mirroring the tolerant-read pattern used by
 * `readPolicy` in weekly-schedule-editor.ts.
 */
export function readEventHistoryRetentionPolicy(
  value: unknown,
): EventHistoryRetentionPolicyInput {
  const record = asRecord(value);
  const policy = asRecord(record?.policy) ?? record;
  if (policy === undefined) return DEFAULT_POLICY_INPUT;
  const segments = asRecord(policy.segments);
  const exportsPolicy = asRecord(policy.exports);
  return Object.freeze({
    automaticPruneEnabled:
      typeof policy.automaticPruneEnabled === "boolean"
        ? policy.automaticPruneEnabled
        : DEFAULT_POLICY_INPUT.automaticPruneEnabled,
    minSealedSegments: readInteger(
      segments?.minSealedSegments,
      DEFAULT_POLICY_INPUT.minSealedSegments,
    ),
    maxSealedSegments: readInteger(
      segments?.maxSealedSegments,
      DEFAULT_POLICY_INPUT.maxSealedSegments,
    ),
    maxSealedSegmentAgeDays: readInteger(
      segments?.maxSealedSegmentAgeDays,
      DEFAULT_POLICY_INPUT.maxSealedSegmentAgeDays,
    ),
    minExports: readInteger(
      exportsPolicy?.minExports,
      DEFAULT_POLICY_INPUT.minExports,
    ),
    maxExports: readInteger(
      exportsPolicy?.maxExports,
      DEFAULT_POLICY_INPUT.maxExports,
    ),
    maxExportAgeDays: readInteger(
      exportsPolicy?.maxExportAgeDays,
      DEFAULT_POLICY_INPUT.maxExportAgeDays,
    ),
  });
}

/**
 * Client-side mirror of the server's bounds
 * (`createRetentionPolicy` in src/event-history/domain/event-history-record.ts).
 * This is a UX convenience only -- the server re-validates and is the sole
 * source of truth; a client-side pass that let something through would still
 * be rejected server-side.
 */
export function validateEventHistoryRetentionPolicyInput(
  input: EventHistoryRetentionPolicyInput,
): string | null {
  if (!boundedInteger(input.minSealedSegments, 1, 1_000))
    return "Minimum sealed segments must be between 1 and 1000.";
  if (!boundedInteger(input.maxSealedSegments, 1, 10_000))
    return "Maximum sealed segments must be between 1 and 10000.";
  if (!boundedInteger(input.maxSealedSegmentAgeDays, 1, 3_650))
    return "Maximum sealed segment age must be between 1 and 3650 days.";
  if (!boundedInteger(input.minExports, 0, 100))
    return "Minimum exports must be between 0 and 100.";
  if (!boundedInteger(input.maxExports, 1, 1_000))
    return "Maximum exports must be between 1 and 1000.";
  if (!boundedInteger(input.maxExportAgeDays, 1, 3_650))
    return "Maximum export age must be between 1 and 3650 days.";
  if (input.maxSealedSegments < input.minSealedSegments)
    return "Maximum sealed segments cannot be less than the minimum.";
  if (input.maxExports < input.minExports)
    return "Maximum exports cannot be less than the minimum.";
  return null;
}

/** Builds the exact `policy` object the server's exact-key parser expects. */
export function buildEventHistoryRetentionPolicyRequestBody(
  input: EventHistoryRetentionPolicyInput,
): Readonly<{
  confirmation: "confirm_administrative_event_history_retention_update";
  policy: unknown;
}> {
  return Object.freeze({
    confirmation:
      "confirm_administrative_event_history_retention_update" as const,
    policy: Object.freeze({
      schemaVersion: 1 as const,
      automaticPruneEnabled: input.automaticPruneEnabled,
      segments: Object.freeze({
        minSealedSegments: input.minSealedSegments,
        maxSealedSegments: input.maxSealedSegments,
        maxSealedSegmentAgeDays: input.maxSealedSegmentAgeDays,
      }),
      exports: Object.freeze({
        minExports: input.minExports,
        maxExports: input.maxExports,
        maxExportAgeDays: input.maxExportAgeDays,
      }),
    }),
  });
}

export function renderSettings(
  document: Document,
  parent: HTMLElement,
  value: unknown,
  onSaved: () => Promise<void>,
): void {
  parent.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Settings";
  parent.append(heading);

  const intro = document.createElement("p");
  intro.textContent =
    "Settings surfaces the one server-owned, administrable policy the " +
    "administrative API currently exposes for mutation: event-history " +
    "retention. Everything else an operator configures lives on its own " +
    "page (Backups, Schedules, Machine) next to the data it governs.";
  parent.append(intro);

  const record = asRecord(value);
  const summaryHeading = document.createElement("h3");
  summaryHeading.textContent = "Event history retention";
  parent.append(summaryHeading);

  const summary = document.createElement("ul");
  for (const line of [
    `Retained events: ${displayValue(record?.retainedEventCount)}`,
    `Sealed segments: ${displayValue(record?.sealedSegmentCount)} (${displayValue(record?.eligibleSegmentCount)} eligible for pruning)`,
    `Exports: ${displayValue(record?.exportCount)} (${displayValue(record?.eligibleExportCount)} eligible for pruning)`,
    `Earliest retained sequence: ${displayValue(record?.earliestRetainedSequence)}`,
    `Latest sequence: ${displayValue(record?.latestSequence)}`,
  ]) {
    const item = document.createElement("li");
    item.textContent = line;
    summary.append(item);
  }
  parent.append(summary);

  const policy = readEventHistoryRetentionPolicy(value);
  const form = document.createElement("form");
  form.className = "event-history-retention-form";

  const automaticPruneLabel = document.createElement("label");
  const automaticPruneInput = document.createElement("input");
  automaticPruneInput.type = "checkbox";
  automaticPruneInput.checked = policy.automaticPruneEnabled;
  automaticPruneLabel.append(
    automaticPruneInput,
    document.createTextNode(" Automatic prune enabled"),
  );
  form.append(automaticPruneLabel);

  const numberField = (
    labelText: string,
    fieldValue: number,
    min: number,
    max: number,
  ): HTMLInputElement => {
    const label = document.createElement("label");
    label.append(document.createTextNode(labelText));
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = String(fieldValue);
    input.required = true;
    label.append(input);
    form.append(label);
    return input;
  };

  const minSealedSegments = numberField(
    "Minimum sealed segments",
    policy.minSealedSegments,
    1,
    1_000,
  );
  const maxSealedSegments = numberField(
    "Maximum sealed segments",
    policy.maxSealedSegments,
    1,
    10_000,
  );
  const maxSealedSegmentAgeDays = numberField(
    "Maximum sealed segment age (days)",
    policy.maxSealedSegmentAgeDays,
    1,
    3_650,
  );
  const minExports = numberField("Minimum exports", policy.minExports, 0, 100);
  const maxExports = numberField(
    "Maximum exports",
    policy.maxExports,
    1,
    1_000,
  );
  const maxExportAgeDays = numberField(
    "Maximum export age (days)",
    policy.maxExportAgeDays,
    1,
    3_650,
  );

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Update retention policy";
  form.append(button, status);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input: EventHistoryRetentionPolicyInput = Object.freeze({
      automaticPruneEnabled: automaticPruneInput.checked,
      minSealedSegments: Number(minSealedSegments.value),
      maxSealedSegments: Number(maxSealedSegments.value),
      maxSealedSegmentAgeDays: Number(maxSealedSegmentAgeDays.value),
      minExports: Number(minExports.value),
      maxExports: Number(maxExports.value),
      maxExportAgeDays: Number(maxExportAgeDays.value),
    });
    const error = validateEventHistoryRetentionPolicyInput(input);
    if (error !== null) {
      status.textContent = error;
      return;
    }
    if (
      !document.defaultView?.confirm(
        "Update the event-history retention policy? This action is audited.",
      )
    )
      return;
    button.disabled = true;
    void fetch("/admin/event-history/retention", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildEventHistoryRetentionPolicyRequestBody(input)),
      redirect: "error",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("retention_update_failed");
        status.textContent = "Saved.";
        await onSaved();
      })
      .catch(() => {
        status.textContent =
          "Retention policy update failed; state was not assumed.";
      })
      .finally(() => {
        button.disabled = false;
      });
  });

  parent.append(form);
}

function readInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fallback;
}

function boundedInteger(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function displayValue(value: unknown): string {
  return typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "unavailable";
}
