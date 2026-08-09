import { initializeDashboardNavigation } from "./navigation.js";
import {
  renderMachinePlan as renderMachinePlanView,
  renderMachineSchedule as renderMachineScheduleView,
} from "./machine-plan-view.js";
import { renderScheduleTimeline } from "./schedule-view.js";
import { renderWeeklyScheduleEditor } from "./weekly-schedule-editor.js";

initializeDashboardNavigation(document);

const root = document.querySelector<HTMLElement>("#app");
const services = document.querySelector<HTMLElement>("#services");
const availability = document.querySelector<HTMLElement>("#availability");
const audit = document.querySelector<HTMLElement>("#audit");
const backups = document.querySelector<HTMLElement>("#backups");
const infrastructure = document.querySelector<HTMLElement>(
  "#infrastructure-placeholder",
);
const powerControls = document.querySelector<HTMLElement>("#power-controls");

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error("request_failed");
  return response.json() as Promise<unknown>;
}

function addText(parent: HTMLElement, value: unknown): void {
  parent.append(
    document.createTextNode(
      typeof value === "string" ? value : JSON.stringify(value),
    ),
  );
}

function renderOverview(value: unknown): void {
  if (root === null) return;
  root.replaceChildren();
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const grid = document.createElement("div");
  grid.className = "overview-grid";
  const services = readRecord(record.services);
  const powerSafety = readRecord(record.powerSafety);
  const machinePlan = readRecord(record.machinePlan);
  const backups = readRecord(record.backups);
  const administration = readRecord(record.administration);
  appendOverviewCard(
    grid,
    "Services",
    `${displayValue(services.registered, "0")} registered`,
    "services",
  );
  appendOverviewCard(
    grid,
    "Power safety",
    `${displayValue(powerSafety.backend, "unavailable")} · effects ${displayValue(powerSafety.effects, "unavailable")}`,
    "machine",
  );
  appendOverviewCard(
    grid,
    "Machine",
    `expectation ${displayValue(machinePlan.expectation, "unavailable")}`,
    "machine",
  );
  appendOverviewCard(
    grid,
    "Backups",
    `${displayValue(backups.activeRuns, "0")} active · ${displayValue(backups.interruptedRuns, "0")} interrupted`,
    "backups",
  );
  appendOverviewCard(
    grid,
    "Observed at",
    displayValue(record.observedAt, "unavailable"),
    "infrastructure",
  );
  const metadata = document.createElement("p");
  metadata.textContent = `Version: ${displayValue(record.applicationVersion, "unavailable")} · source: ${displayValue(record.sourceCommit, "unavailable")}`;
  root.append(grid, metadata);
  renderPowerControls(administration, powerSafety);
}

function renderPowerControls(
  administration: Readonly<Record<string, unknown>>,
  powerSafety: Readonly<Record<string, unknown>>,
): void {
  if (powerControls === null) return;
  powerControls.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Mock power controls";
  const note = document.createElement("p");
  note.textContent = `Backend: ${displayValue(powerSafety.backend, "unavailable")} · effects: ${displayValue(powerSafety.effects, "unavailable")} · scheduler: ${displayValue(powerSafety.machineScheduler, "unavailable")}`;
  powerControls.append(heading, note);

  const wakeEnabled = administration.wakeAlarmEnabled === true;
  const shutdownEnabled = administration.shutdownEnabled === true;
  if (!wakeEnabled && !shutdownEnabled) {
    const disabled = document.createElement("p");
    disabled.textContent =
      "Wake-alarm and shutdown HTTP controls are disabled by configuration.";
    powerControls.append(disabled);
    return;
  }

  if (wakeEnabled) renderWakeAlarmControls(powerControls);
  if (shutdownEnabled) renderShutdownPreparationControl(powerControls);
}

function renderWakeAlarmControls(parent: HTMLElement): void {
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "Mock wake time";
  const input = document.createElement("input");
  input.type = "datetime-local";
  input.required = true;
  input.setAttribute("aria-label", "Mock wake time");
  const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
  input.value = defaultTime.toISOString().slice(0, 16);
  label.append(input);
  const schedule = document.createElement("button");
  schedule.type = "submit";
  schedule.textContent = "Schedule mock wake";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel mock wake";
  form.append(label, schedule, cancel);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void powerRequest(
      "/admin/power/wake-alarm",
      "PUT",
      { scheduledFor: new Date(input.value).toISOString() },
      schedule,
    );
  });
  cancel.addEventListener("click", () => {
    void powerRequest("/admin/power/wake-alarm", "DELETE", undefined, cancel);
  });
  parent.append(form);
}

function renderShutdownPreparationControl(parent: HTMLElement): void {
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "Mock shutdown preparation";
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Prepare mock shutdown";
  form.append(label, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!window.confirm("Prepare a mock shutdown occurrence?")) return;
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000);
    const wakeScheduledFor = new Date(scheduledFor.getTime() + 60 * 60 * 1000);
    void powerRequest(
      "/admin/power/shutdown/preparations",
      "POST",
      {
        operation: "shutdown",
        scheduledFor: scheduledFor.toISOString(),
        wakeScheduledFor: wakeScheduledFor.toISOString(),
        confirmation: "confirm_shutdown_preparation",
      },
      button,
    );
  });
  parent.append(form);
}

async function powerRequest(
  path: string,
  method: "PUT" | "DELETE" | "POST",
  body: unknown,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
      redirect: "error",
    });
    if (!response.ok) throw new Error("power_operation_failed");
    if (status !== null) status.textContent = "Mock power state updated.";
    await refresh();
  } catch {
    if (status !== null)
      status.textContent = "Mock power state could not be updated.";
  } finally {
    button.disabled = false;
  }
}

function appendOverviewCard(
  parent: HTMLElement,
  headingText: string,
  valueText: string,
  page: string,
): void {
  const article = document.createElement("article");
  article.className = "overview-card";
  const heading = document.createElement("h3");
  heading.textContent = headingText;
  const value = document.createElement("p");
  value.textContent = valueText;
  const link = document.createElement("a");
  link.href = `#${page}`;
  link.append(heading, value);
  article.append(link);
  parent.append(article);
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function displayValue(value: unknown, fallback: string): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : fallback;
}

function renderInfrastructure(value: unknown): void {
  if (infrastructure === null) return;
  infrastructure.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Infrastructure";
  infrastructure.append(heading);
  const record = readRecord(value);
  const routeCatalog = readRecord(record.routeCatalog);
  const lines = [
    `Route catalog: ${displayValue(routeCatalog.routeCount, "unavailable")} routes · reconciled ${displayValue(routeCatalog.reconciled, "unknown")}`,
    `Loopback binding: ${displayValue(record.loopbackBinding, "unknown")}`,
    `CORS disabled: ${displayValue(record.corsDisabled, "unknown")}`,
    `Trust proxy disabled: ${displayValue(record.trustProxyDisabled, "unknown")}`,
    `Audit available: ${displayValue(record.auditAvailable, "unknown")}`,
  ];
  const list = document.createElement("ul");
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  infrastructure.append(list);
  const activationFlags = readRecord(record.activationFlags);
  const flagsHeading = document.createElement("h3");
  flagsHeading.textContent = "Administrative feature flags";
  infrastructure.append(flagsHeading);
  const flags = document.createElement("ul");
  for (const flag of Object.keys(activationFlags).sort()) {
    const item = document.createElement("li");
    item.textContent = `${flag}: ${activationFlags[flag] === true ? "enabled" : "disabled"}`;
    flags.append(item);
  }
  if (flags.childElementCount === 0)
    addText(flags, "Feature flag state unavailable.");
  infrastructure.append(flags);
}

function renderServices(value: unknown): void {
  if (services === null) return;
  services.replaceChildren();
  const list =
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { services?: unknown }).services)
      ? (value as { services: readonly Record<string, unknown>[] }).services
      : [];
  if (list.length === 0) {
    addText(services, "No registered services.");
    return;
  }
  for (const service of list) {
    const article = document.createElement("article");
    const heading = document.createElement("h3");
    addText(heading, service.id);
    article.append(heading);
    const summary = document.createElement("p");
    addText(
      summary,
      `${String(service.displayName)} — ${String(service.status)} — ${String(service.availability)}`,
    );
    article.append(summary);
    const metadata = document.createElement("p");
    addText(
      metadata,
      `Adapter: ${String(service.managementKind)} · Dependencies: ${Array.isArray(service.dependencies) ? service.dependencies.join(", ") || "none" : "unavailable"}`,
    );
    article.append(metadata);
    for (const operation of ["start", "stop", "restart"] as const) {
      const form = document.createElement("form");
      form.className = "mutation";
      const button = document.createElement("button");
      button.type = "submit";
      addText(button, operation);
      form.append(button);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (
          !window.confirm(
            `${operation} ${String(service.displayName)}? This action is audited.`,
          )
        )
          return;
        button.disabled = true;
        void fetch(
          `/admin/services/${encodeURIComponent(String(service.id))}/actions/${operation}`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              confirmation: `confirm_registered_service_${operation}`,
            }),
            redirect: "error",
          },
        )
          .then(async (response) => {
            if (!response.ok) throw new Error("operation_failed");
            await refresh();
          })
          .catch(() => {
            if (status !== null)
              addText(
                status,
                "Operation failed; authoritative state was not assumed.",
              );
          })
          .finally(() => {
            button.disabled = false;
          });
      });
      article.append(form);
    }
    const logsButton = document.createElement("button");
    logsButton.type = "button";
    addText(logsButton, "Logs");
    logsButton.addEventListener("click", () => {
      logsButton.disabled = true;
      void fetch(
        `/admin/services/${encodeURIComponent(String(service.id))}/logs`,
        { credentials: "same-origin", redirect: "error" },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error("logs_failed");
          const value: unknown = await response.json();
          let output = article.querySelector<HTMLElement>(".service-logs");
          if (output === null) {
            output = document.createElement("pre");
            output.className = "service-logs";
            article.append(output);
          }
          output.textContent = JSON.stringify(value, null, 2);
        })
        .catch(() => {
          if (status !== null) status.textContent = "Service logs unavailable.";
        })
        .finally(() => {
          logsButton.disabled = false;
        });
    });
    article.append(logsButton);
    services.append(article);
  }
}

function renderAudit(value: unknown): void {
  if (audit === null) return;
  audit.textContent = "";
  addText(audit, value);
}

function renderMachinePlan(value: unknown): void {
  const section = document.querySelector<HTMLElement>(
    'main > section[aria-labelledby="safety-heading"]',
  );
  if (section === null) return;
  let plan = section.querySelector<HTMLElement>("#machine-plan");
  if (plan === null) {
    plan = document.createElement("div");
    plan.id = "machine-plan";
    section.append(plan);
  }
  const machinePlan =
    typeof value === "object" && value !== null
      ? (value as { machinePlan?: unknown }).machinePlan
      : undefined;
  renderMachinePlanView(document, plan, machinePlan);
  let schedule = section.querySelector<HTMLElement>("#machine-schedule");
  if (schedule === null) {
    schedule = document.createElement("div");
    schedule.id = "machine-schedule";
    section.append(schedule);
  }
  const machineSchedule =
    typeof value === "object" && value !== null
      ? (value as { machineSchedule?: unknown }).machineSchedule
      : undefined;
  renderMachineScheduleView(document, schedule, machineSchedule);
}

function renderAvailability(value: unknown): void {
  if (availability === null) return;
  availability.replaceChildren();
  if (!Array.isArray(value) || value.length === 0) {
    addText(availability, "No service schedules available.");
    return;
  }
  for (const entry of value) {
    const article = document.createElement("article");
    const heading = document.createElement("h3");
    const serviceId =
      typeof entry === "object" && entry !== null
        ? (entry as { serviceId?: unknown }).serviceId
        : undefined;
    addText(heading, serviceId ?? "Unknown service");
    article.append(heading);
    renderScheduleTimeline(document, article, entry);
    if (
      typeof serviceId === "string" &&
      readRecord(entry).scheduleEditable !== false
    )
      renderWeeklyScheduleEditor(document, article, serviceId, entry, refresh);
    availability.append(article);
  }
}

function renderBackups(value: unknown, runsValue: unknown): void {
  if (backups === null) return;
  backups.replaceChildren();
  const list =
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { targets?: unknown }).targets)
      ? (value as { targets: readonly Record<string, unknown>[] }).targets
      : [];
  if (list.length === 0) {
    addText(backups, "No registered backup targets.");
    return;
  }
  for (const target of list) {
    const article = document.createElement("article");
    const heading = document.createElement("h3");
    addText(heading, target.displayName ?? target.id);
    const summary = document.createElement("p");
    addText(
      summary,
      `${String(target.id)} — ${String(target.kind)} — ${String(target.scheduleMode)}`,
    );
    article.append(heading, summary);
    const runs =
      typeof runsValue === "object" &&
      runsValue !== null &&
      Array.isArray((runsValue as { runs?: unknown }).runs)
        ? (runsValue as { runs: readonly Record<string, unknown>[] }).runs
            .filter((run) => run.targetId === target.id)
            .slice(-5)
        : [];
    const history = document.createElement("ul");
    for (const run of runs) {
      const item = document.createElement("li");
      addText(
        item,
        `${String(run.runId)} — ${String(run.status)} — ${String(run.trigger)}`,
      );
      history.append(item);
    }
    article.append(history);
    appendBackupPolicyForm(
      article,
      "schedule",
      target.id,
      "/schedule",
      "confirm_registered_backup_schedule_update",
      { mode: "manual" },
    );
    appendBackupPolicyForm(
      article,
      "retention",
      target.id,
      "/retention",
      "confirm_registered_backup_retention_update",
      { keepLastSuccessful: 1 },
    );
    appendBackupActionForm(
      article,
      "Prune retention",
      target.id,
      "/retention/prunes",
      "confirm_registered_backup_retention_prune",
    );
    backups.append(article);
  }
  const note = document.createElement("p");
  addText(note, "Local-only backups. Restoration is not supported.");
  backups.append(note);
}

function appendBackupPolicyForm(
  parent: HTMLElement,
  labelText: string,
  targetId: unknown,
  suffix: string,
  confirmation: string,
  defaultPolicy: unknown,
): void {
  const form = document.createElement("form");
  const label = document.createElement("label");
  addText(label, `${labelText} confirmation`);
  const confirmationInput = document.createElement("input");
  confirmationInput.required = true;
  confirmationInput.autocomplete = "off";
  label.append(confirmationInput);
  const policy = document.createElement("input");
  policy.value = JSON.stringify(defaultPolicy);
  policy.required = true;
  policy.setAttribute("aria-label", `${labelText} JSON`);
  const button = document.createElement("button");
  button.type = "submit";
  addText(button, `Update ${labelText}`);
  form.append(label, policy, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    button.disabled = true;
    let decoded: unknown;
    try {
      decoded = JSON.parse(policy.value);
    } catch {
      decoded = undefined;
    }
    void fetch(
      `/admin/backups/targets/${encodeURIComponent(String(targetId))}${suffix}`,
      {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: confirmation, policy: decoded }),
        redirect: "error",
      },
    )
      .then(async (response) => {
        confirmationInput.value = "";
        if (!response.ok) throw new Error("operation_failed");
        await refresh();
      })
      .catch(() => {
        confirmationInput.value = "";
        if (status !== null)
          status.textContent = "Backup state could not be reread.";
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  parent.append(form);
}

function appendBackupActionForm(
  parent: HTMLElement,
  labelText: string,
  targetId: unknown,
  suffix: string,
  confirmation: string,
): void {
  const form = document.createElement("form");
  const label = document.createElement("label");
  addText(label, `${labelText} confirmation`);
  const input = document.createElement("input");
  input.required = true;
  input.autocomplete = "off";
  label.append(input);
  const button = document.createElement("button");
  button.type = "submit";
  addText(button, labelText);
  form.append(label, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    button.disabled = true;
    void fetch(
      `/admin/backups/targets/${encodeURIComponent(String(targetId))}${suffix}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
        redirect: "error",
      },
    )
      .then(async (response) => {
        input.value = "";
        if (!response.ok) throw new Error("operation_failed");
        await refresh();
      })
      .catch(() => {
        input.value = "";
        if (status !== null)
          status.textContent = "Backup state could not be reread.";
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  parent.append(form);
}

const status = document.querySelector<HTMLElement>("#status");
async function refresh(): Promise<void> {
  const [
    overview,
    serviceList,
    history,
    integrity,
    retention,
    exports,
    backupTargets,
    backupRuns,
    securityPosture,
  ] = await Promise.all([
    readJson("/admin/overview"),
    readJson("/admin/services"),
    readJson("/admin/event-history?limit=20"),
    readJson("/admin/event-history/integrity").catch(() => ({
      outcome: "unavailable",
    })),
    readJson("/admin/event-history/retention").catch(() => ({
      eligibleSegmentCount: 0,
    })),
    readJson("/admin/event-history/exports").catch(() => ({ exports: [] })),
    readJson("/admin/backups/targets").catch(() => ({ targets: [] })),
    readJson("/admin/backups/runs?limit=20").catch(() => ({ runs: [] })),
    readJson("/admin/security/status").catch(() => ({ status: "unavailable" })),
  ]);
  const serviceValues =
    typeof serviceList === "object" &&
    serviceList !== null &&
    Array.isArray((serviceList as { services?: unknown }).services)
      ? (serviceList as { services: readonly Record<string, unknown>[] })
          .services
      : [];
  const policies = await Promise.all(
    serviceValues.map(async (service) => {
      const servicePath = encodeURIComponent(String(service.id));
      const schedule = await readJson(
        `/admin/services/${servicePath}/schedule`,
      ).catch(() => null);
      if (schedule !== null) return { value: schedule, scheduleEditable: true };
      const availability = await readJson(
        `/admin/services/${servicePath}/availability`,
      ).catch(() => null);
      return { value: availability, scheduleEditable: false };
    }),
  );
  const previewWindow = createPreviewWindow();
  const previews = await Promise.all(
    serviceValues.map((service) =>
      readJson(
        `/admin/services/${encodeURIComponent(String(service.id))}/availability/preview?startsAt=${encodeURIComponent(previewWindow.startsAt)}&endsAt=${encodeURIComponent(previewWindow.endsAt)}`,
      ).catch(() => null),
    ),
  );
  const schedules = policies.map(({ value, scheduleEditable }, index) => ({
    ...(typeof value === "object" && value !== null ? value : {}),
    scheduleEditable,
    preview: previews[index],
  }));
  renderOverview(overview);
  renderMachinePlan(overview);
  renderServices(serviceList);
  renderAvailability(schedules);
  renderAudit({ history, integrity, retention, exports });
  renderBackups(backupTargets, backupRuns);
  renderInfrastructure(securityPosture);
}

function createPreviewWindow(): Readonly<{
  startsAt: string;
  endsAt: string;
}> {
  const starts = new Date();
  starts.setUTCSeconds(0, 0);
  return {
    startsAt: starts.toISOString(),
    endsAt: new Date(starts.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

void refresh().catch(() => {
  if (status !== null)
    status.textContent = "Administrative overview unavailable.";
});
