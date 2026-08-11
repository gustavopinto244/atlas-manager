// Presentation and mutation for the machine operating policy editor
// (ADR-033). Reuses the weekly-window editing primitives from
// weekly-schedule-editor.ts (day/time-window selection, copy-to-days,
// clear-day/-week, validation) -- the machine's weeklySchedule.windows shape
// is the same weekday+HH:MM model the service schedule editor already
// handles, just under the field name `dayOfWeek` instead of `weekday` and
// with three modes (`always_on`, `manual`, `scheduled`) instead of four.
//
// This editor never touches the running scheduler or any physical power
// effect: it only edits the declared policy the persisted
// MachineOperatingPolicyStore holds (see ADR-033), through
// GET/PUT/DELETE /admin/machine/schedule and its preview route.

import {
  EDITOR_WEEKDAYS,
  clearDayWindow,
  copyWindowToDays,
  validateWeeklyEditorWindows,
  type EditorWeekday,
  type WeeklyEditorWindow,
} from "./weekly-schedule-editor.js";

const MACHINE_SCHEDULE_MODES = ["always_on", "manual", "scheduled"] as const;

export function toDomainWindows(
  windows: readonly WeeklyEditorWindow[],
): readonly Readonly<{ dayOfWeek: string; start: string; end: string }>[] {
  return windows.map((window) => ({
    dayOfWeek: window.weekday,
    start: window.start,
    end: window.end,
  }));
}

export function fromDomainWindows(
  value: unknown,
): readonly WeeklyEditorWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): WeeklyEditorWindow[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const window = entry as Record<string, unknown>;
    return typeof window.dayOfWeek === "string" &&
      typeof window.start === "string" &&
      typeof window.end === "string"
      ? [{ weekday: window.dayOfWeek, start: window.start, end: window.end }]
      : [];
  });
}

export function readMachinePolicy(value: unknown): Readonly<{
  mode: string;
  timezone: string;
  windows: readonly WeeklyEditorWindow[];
}> {
  const fallback = {
    mode: "always_on",
    timezone: "America/Sao_Paulo",
    windows: [] as readonly WeeklyEditorWindow[],
  };
  if (typeof value !== "object" || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const policy = record.policy;
  const source =
    typeof policy === "object" && policy !== null
      ? (policy as Record<string, unknown>)
      : record;
  const weeklySchedule = source.weeklySchedule;
  const windows = fromDomainWindows(
    typeof weeklySchedule === "object" && weeklySchedule !== null
      ? (weeklySchedule as Record<string, unknown>).windows
      : undefined,
  );
  return {
    mode: typeof source.mode === "string" ? source.mode : fallback.mode,
    timezone:
      typeof source.timezone === "string" ? source.timezone : fallback.timezone,
    windows,
  };
}

export function renderMachineScheduleEditor(
  document: Document,
  parent: HTMLElement,
  value: unknown,
  onSaved: () => Promise<void>,
): void {
  parent.replaceChildren();
  const policy = readMachinePolicy(value);
  let windows: readonly WeeklyEditorWindow[] = policy.windows;
  let dirty = false;

  const form = document.createElement("form");
  form.className = "machine-schedule-editor";
  const heading = document.createElement("h4");
  heading.textContent = "Machine schedule editor";
  form.append(heading);

  const markDirty = (): void => {
    dirty = true;
    dirtyIndicator.textContent = "Unsaved changes.";
  };
  const markClean = (): void => {
    dirty = false;
    dirtyIndicator.textContent = "";
  };
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!dirty) return;
    event.preventDefault();
  };
  document.defaultView?.addEventListener("beforeunload", beforeUnload);

  const modeLabel = document.createElement("label");
  modeLabel.textContent = "Mode ";
  const mode = document.createElement("select");
  for (const option of MACHINE_SCHEDULE_MODES) {
    const element = document.createElement("option");
    element.value = option;
    element.textContent = option;
    element.selected = option === policy.mode;
    mode.append(element);
  }
  mode.addEventListener("change", markDirty);
  modeLabel.append(mode);
  form.append(modeLabel);

  const timezoneLabel = document.createElement("label");
  timezoneLabel.textContent = "Timezone ";
  const timezone = document.createElement("input");
  timezone.value = policy.timezone;
  timezone.required = true;
  timezone.setAttribute("aria-label", "Machine schedule timezone");
  timezone.addEventListener("input", markDirty);
  timezoneLabel.append(timezone);
  form.append(timezoneLabel);

  const daysContainer = document.createElement("div");
  daysContainer.className = "machine-schedule-days";
  form.append(daysContainer);

  const fields = new Map<
    EditorWeekday,
    Readonly<{
      enabled: HTMLInputElement;
      start: HTMLInputElement;
      end: HTMLInputElement;
      copyTarget: HTMLInputElement;
    }>
  >();

  const syncFieldState = (weekday: EditorWeekday): void => {
    const field = fields.get(weekday)!;
    const on = field.enabled.checked;
    field.start.disabled = !on;
    field.end.disabled = !on;
    if (!on) {
      field.start.value = "";
      field.end.value = "";
    }
  };

  const readWindowsFromFields = (): readonly WeeklyEditorWindow[] =>
    EDITOR_WEEKDAYS.flatMap((weekday) => {
      const field = fields.get(weekday)!;
      if (!field.enabled.checked || !field.start.value || !field.end.value)
        return [];
      return [{ weekday, start: field.start.value, end: field.end.value }];
    });

  const applyWindowsToFields = (): void => {
    for (const weekday of EDITOR_WEEKDAYS) {
      const field = fields.get(weekday)!;
      const existing = windows.find((window) => window.weekday === weekday);
      field.enabled.checked = existing !== undefined;
      field.start.value = existing?.start ?? "";
      field.end.value = existing?.end ?? "";
      syncFieldState(weekday);
    }
  };

  for (const weekday of EDITOR_WEEKDAYS) {
    const row = document.createElement("div");
    row.className = "machine-schedule-day-row";

    const label = document.createElement("label");
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.setAttribute("aria-label", `${weekday} enabled`);
    label.append(enabled, document.createTextNode(` ${weekday} `));

    const start = document.createElement("input");
    start.type = "time";
    start.setAttribute("aria-label", `${weekday} start`);
    const end = document.createElement("input");
    end.type = "time";
    end.setAttribute("aria-label", `${weekday} end`);
    label.append(start, document.createTextNode(" → "), end);

    const copyTarget = document.createElement("input");
    copyTarget.type = "checkbox";
    copyTarget.className = "machine-schedule-copy-target";
    copyTarget.setAttribute(
      "aria-label",
      `Include ${weekday} when copying a window`,
    );
    const copyTargetLabel = document.createElement("label");
    copyTargetLabel.append(copyTarget, document.createTextNode(" copy target"));

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "Clear day";
    clearButton.addEventListener("click", () => {
      windows = clearDayWindow(windows, weekday);
      applyWindowsToFields();
      markDirty();
    });

    const copyFromButton = document.createElement("button");
    copyFromButton.type = "button";
    copyFromButton.textContent = "Copy to selected";
    copyFromButton.addEventListener("click", () => {
      windows = readWindowsFromFields();
      const targets = EDITOR_WEEKDAYS.filter(
        (candidate) => fields.get(candidate)!.copyTarget.checked,
      );
      windows = copyWindowToDays(windows, weekday, targets);
      applyWindowsToFields();
      markDirty();
    });

    for (const input of [enabled, start, end])
      input.addEventListener("input", markDirty);
    enabled.addEventListener("change", () => {
      syncFieldState(weekday);
      markDirty();
    });

    row.append(label, copyTargetLabel, copyFromButton, clearButton);
    daysContainer.append(row);
    fields.set(weekday, { enabled, start, end, copyTarget });
  }
  applyWindowsToFields();

  const clearWeekButton = document.createElement("button");
  clearWeekButton.type = "button";
  clearWeekButton.textContent = "Clear week";
  clearWeekButton.addEventListener("click", () => {
    windows = [];
    applyWindowsToFields();
    markDirty();
  });
  form.append(clearWeekButton);

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const dirtyIndicator = document.createElement("p");
  dirtyIndicator.className = "machine-schedule-dirty-indicator";
  dirtyIndicator.setAttribute("role", "status");

  const previewOutput = document.createElement("pre");
  previewOutput.className = "machine-schedule-preview-output";

  const currentPolicyInput = (): unknown => {
    windows = readWindowsFromFields();
    return mode.value === "scheduled"
      ? {
          mode: "scheduled",
          timezone: timezone.value,
          weeklySchedule: { windows: toDomainWindows(windows) },
        }
      : { mode: mode.value };
  };

  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.textContent = "Preview";
  previewButton.addEventListener("click", () => {
    const policyInput = currentPolicyInput();
    const error =
      mode.value === "scheduled"
        ? validateWeeklyEditorWindows(windows, timezone.value)
        : null;
    if (error !== null) {
      status.textContent = error;
      return;
    }
    previewButton.disabled = true;
    void fetch(
      `/admin/machine/schedule/preview?policy=${encodeURIComponent(JSON.stringify(policyInput))}`,
      { credentials: "same-origin", redirect: "error" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("preview_failed");
        const result: unknown = await response.json();
        previewOutput.textContent = JSON.stringify(result, null, 2);
      })
      .catch(() => {
        previewOutput.textContent = "Preview unavailable.";
      })
      .finally(() => {
        previewButton.disabled = false;
      });
  });

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Save machine schedule";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove persisted schedule";
  removeButton.addEventListener("click", () => {
    if (
      !window.confirm(
        "Remove the persisted machine schedule? This reverts to the environment default and is audited.",
      )
    )
      return;
    removeButton.disabled = true;
    void fetch("/admin/machine/schedule", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmation: "confirm_machine_operating_policy_removal",
      }),
      redirect: "error",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("machine_schedule_removal_failed");
        markClean();
        status.textContent = "Removed.";
        await onSaved();
      })
      .catch(() => {
        status.textContent =
          "Machine schedule removal failed; state was not assumed.";
      })
      .finally(() => {
        removeButton.disabled = false;
      });
  });

  form.append(previewButton, button, removeButton, status, dirtyIndicator);
  form.append(previewOutput);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const policyInput = currentPolicyInput();
    const error =
      mode.value === "scheduled"
        ? validateWeeklyEditorWindows(windows, timezone.value)
        : null;
    if (error !== null) {
      status.textContent = error;
      return;
    }
    if (!window.confirm("Update the machine schedule? This action is audited."))
      return;
    button.disabled = true;
    void fetch("/admin/machine/schedule", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmation: "confirm_machine_operating_policy_update",
        policy: policyInput,
      }),
      redirect: "error",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("machine_schedule_update_failed");
        markClean();
        status.textContent = "Saved.";
        // Authoritative reread, not the submitted value (same pattern as
        // every other mutation in this codebase).
        await onSaved();
      })
      .catch(() => {
        status.textContent =
          "Machine schedule update failed; state was not assumed.";
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  parent.append(form);
}
