export const EDITOR_WEEKDAYS = Object.freeze([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const);

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

export function renderWeeklyScheduleEditor(
  document: Document,
  parent: HTMLElement,
  serviceId: string,
  value: unknown,
  onSaved: () => Promise<void>,
): void {
  const policy = readPolicy(value);
  const form = document.createElement("form");
  form.className = "weekly-schedule-editor";
  const heading = document.createElement("h4");
  heading.textContent = "Schedule editor";
  form.append(heading);

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
  modeLabel.append(mode);
  form.append(modeLabel);

  const timezoneLabel = document.createElement("label");
  timezoneLabel.textContent = "Timezone ";
  const timezone = document.createElement("input");
  timezone.value = policy.timezone;
  timezone.required = true;
  timezone.setAttribute("aria-label", "Schedule timezone");
  timezoneLabel.append(timezone);
  form.append(timezoneLabel);

  const fields = new Map<
    string,
    Readonly<{ start: HTMLInputElement; end: HTMLInputElement }>
  >();
  for (const weekday of EDITOR_WEEKDAYS) {
    const label = document.createElement("label");
    label.textContent = `${weekday} `;
    const start = document.createElement("input");
    start.type = "time";
    start.value =
      policy.windows.find((window) => window.weekday === weekday)?.start ?? "";
    start.setAttribute("aria-label", `${weekday} start`);
    const end = document.createElement("input");
    end.type = "time";
    end.value =
      policy.windows.find((window) => window.weekday === weekday)?.end ?? "";
    end.setAttribute("aria-label", `${weekday} end`);
    label.append(start, document.createTextNode(" → "), end);
    form.append(label);
    fields.set(weekday, { start, end });
  }

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Save schedule";
  form.append(button, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const windows = EDITOR_WEEKDAYS.flatMap((weekday) => {
      const field = fields.get(weekday)!;
      if (!field.start.value && !field.end.value) return [];
      return [{ weekday, start: field.start.value, end: field.end.value }];
    });
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
    const policyInput =
      mode.value === "scheduled"
        ? { mode: "scheduled", timezone: timezone.value, windows }
        : { mode: mode.value };
    void fetch(
      `/admin/services/${encodeURIComponent(serviceId)}/availability`,
      {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: "confirm_registered_service_availability_update",
          policy: policyInput,
        }),
        redirect: "error",
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("schedule_update_failed");
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
