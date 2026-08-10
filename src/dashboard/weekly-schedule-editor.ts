export const EDITOR_WEEKDAYS = Object.freeze([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const);

export type EditorWeekday = (typeof EDITOR_WEEKDAYS)[number];

export type WeeklyEditorWindow = Readonly<{
  weekday: string;
  start: string;
  end: string;
}>;

export function validateWeeklyEditorWindows(
  windows: readonly WeeklyEditorWindow[],
  timezone: string,
): string | null {
  if (!timezone.trim()) return "Timezone is required.";
  if (windows.length === 0) return "Select at least one day.";
  for (const window of windows) {
    if (
      !EDITOR_WEEKDAYS.includes(
        window.weekday as (typeof EDITOR_WEEKDAYS)[number],
      )
    )
      return "Weekday is invalid.";
    if (
      !/^\d{2}:\d{2}$/u.test(window.start) ||
      !/^\d{2}:\d{2}$/u.test(window.end)
    )
      return "Time must use HH:MM.";
    if (window.start >= window.end)
      return "Start time must be before end time.";
  }
  return null;
}

// Copies one day's window onto each target weekday, replacing whatever
// window that target already had. The source day is left untouched even if
// it appears in the target list.
export function copyWindowToDays(
  windows: readonly WeeklyEditorWindow[],
  sourceWeekday: string,
  targetWeekdays: readonly string[],
): readonly WeeklyEditorWindow[] {
  const source = windows.find((window) => window.weekday === sourceWeekday);
  if (source === undefined) return windows;
  const targets = new Set(
    targetWeekdays.filter((weekday) => weekday !== sourceWeekday),
  );
  const kept = windows.filter((window) => !targets.has(window.weekday));
  const copied = [...targets].map((weekday) => ({
    weekday,
    start: source.start,
    end: source.end,
  }));
  return [...kept, ...copied];
}

export function clearDayWindow(
  windows: readonly WeeklyEditorWindow[],
  weekday: string,
): readonly WeeklyEditorWindow[] {
  return windows.filter((window) => window.weekday !== weekday);
}

export function buildSchedulePreviewQuery(input: {
  readonly policy: unknown;
  readonly startsAt: string;
  readonly endsAt: string;
}): string {
  const params = new URLSearchParams({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    policy: JSON.stringify(input.policy),
  });
  return params.toString();
}

export function renderWeeklyScheduleEditor(
  document: Document,
  parent: HTMLElement,
  serviceId: string,
  value: unknown,
  onSaved: () => Promise<void>,
): void {
  const policy = readPolicy(value);
  let windows: readonly WeeklyEditorWindow[] = policy.windows;
  let dirty = false;

  const form = document.createElement("form");
  form.className = "weekly-schedule-editor";
  const heading = document.createElement("h4");
  heading.textContent = "Schedule editor";
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
  for (const option of ["always", "scheduled", "manual", "disabled"] as const) {
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
  timezone.setAttribute("aria-label", "Schedule timezone");
  timezone.addEventListener("input", markDirty);
  timezoneLabel.append(timezone);
  form.append(timezoneLabel);

  const daysContainer = document.createElement("div");
  daysContainer.className = "weekly-schedule-days";
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
    row.className = "weekly-schedule-day-row";

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
    copyTarget.className = "weekly-schedule-copy-target";
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
  dirtyIndicator.className = "weekly-schedule-dirty-indicator";
  dirtyIndicator.setAttribute("role", "status");

  const previewOutput = document.createElement("pre");
  previewOutput.className = "weekly-schedule-preview-output";

  const currentPolicyInput = (): unknown => {
    windows = readWindowsFromFields();
    return mode.value === "scheduled"
      ? { mode: "scheduled", timezone: timezone.value, windows }
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
    const starts = new Date();
    starts.setUTCSeconds(0, 0);
    const ends = new Date(starts.getTime() + 7 * 24 * 60 * 60 * 1000);
    const query = buildSchedulePreviewQuery({
      policy: policyInput,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
    });
    void fetch(
      `/admin/services/${encodeURIComponent(serviceId)}/schedule/preview?${query}`,
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
  button.textContent = "Save schedule";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove custom schedule";
  removeButton.addEventListener("click", () => {
    if (
      !window.confirm(
        `Remove ${serviceId}'s custom schedule? This action is audited.`,
      )
    )
      return;
    removeButton.disabled = true;
    void fetch(`/admin/services/${encodeURIComponent(serviceId)}/schedule`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmation: "confirm_registered_service_schedule_removal",
      }),
      redirect: "error",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("schedule_removal_failed");
        markClean();
        status.textContent = "Removed.";
        await onSaved();
      })
      .catch(() => {
        status.textContent = "Schedule removal failed; state was not assumed.";
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
    if (
      !window.confirm(`Update ${serviceId} schedule? This action is audited.`)
    )
      return;
    button.disabled = true;
    void fetch(`/admin/services/${encodeURIComponent(serviceId)}/schedule`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmation: "confirm_registered_service_schedule_update",
        policy: policyInput,
      }),
      redirect: "error",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("schedule_update_failed");
        markClean();
        status.textContent = "Saved.";
        await onSaved();
      })
      .catch(() => {
        status.textContent = "Schedule update failed; state was not assumed.";
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  parent.append(form);
}

function readPolicy(value: unknown): Readonly<{
  mode: string;
  timezone: string;
  windows: readonly WeeklyEditorWindow[];
}> {
  if (typeof value !== "object" || value === null)
    return { mode: "manual", timezone: "America/Sao_Paulo", windows: [] };
  const record = value as Record<string, unknown>;
  const policy = record.policy;
  if (typeof policy !== "object" || policy === null)
    return { mode: "manual", timezone: "America/Sao_Paulo", windows: [] };
  const source = policy as Record<string, unknown>;
  const windows = Array.isArray(source.windows)
    ? source.windows.flatMap((entry): WeeklyEditorWindow[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const window = entry as Record<string, unknown>;
        return typeof window.weekday === "string" &&
          typeof window.start === "string" &&
          typeof window.end === "string"
          ? [{ weekday: window.weekday, start: window.start, end: window.end }]
          : [];
      })
    : [];
  return {
    mode: typeof source.mode === "string" ? source.mode : "manual",
    timezone:
      typeof source.timezone === "string"
        ? source.timezone
        : "America/Sao_Paulo",
    windows,
  };
}
