import { initializeDashboardNavigation } from "./navigation.js";
import {
  PowerControlsController,
  PowerControlsRequestError,
} from "./power-controls.js";
import {
  renderMachinePlan as renderMachinePlanView,
  renderMachineSchedule as renderMachineScheduleView,
  renderMachinePreview as renderMachinePreviewView,
} from "./machine-plan-view.js";
import { renderScheduleTimeline } from "./schedule-view.js";
import { renderWeeklyScheduleEditor } from "./weekly-schedule-editor.js";
import {
  controlOperationsFor,
  supportsLogs,
  statusChipModifier,
} from "./service-operations.js";
import { resourceObservationSummary } from "./service-resources.js";
import {
  AdministrativeApiClient,
  hasRecordArray,
  isRecord,
  type AdministrativeReadResult,
} from "./api-client.js";
import { SectionStatusRegion } from "./section-state.js";
import {
  DashboardRefreshCoordinator,
  type DashboardSection,
  type SectionLoadResult,
} from "./refresh-coordinator.js";

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
const environmentLabel = document.querySelector<HTMLElement>(
  "#dashboard-environment",
);
const healthLabel = document.querySelector<HTMLElement>("#dashboard-health");
const lastRefreshLabel = document.querySelector<HTMLElement>(
  "#dashboard-last-refresh",
);
const refreshButton =
  document.querySelector<HTMLButtonElement>("#dashboard-refresh");

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw powerControlsHttpError(response.status);
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
  // The overview envelope nests the version under "application"; reading it
  // from the root reported "unavailable" on every build regardless of the
  // configured value. There is no sourceCommit field in the contract, so the
  // dashboard no longer claims one.
  const applicationVersion = displayValue(
    readRecord(record.application).version,
    "unavailable",
  );
  const metadata = document.createElement("p");
  metadata.textContent = `Version: ${applicationVersion}`;
  root.append(grid, metadata);
  if (environmentLabel !== null)
    environmentLabel.textContent = `Release: ${applicationVersion}`;
  if (powerControls !== null)
    void powerControlsController.render(
      powerControls,
      administration,
      powerSafety,
    );
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
  const list = readServiceList(value);
  for (const service of list) {
    const article = document.createElement("article");
    article.className = "service-card";
    const heading = document.createElement("h3");
    addText(heading, service.displayName ?? service.id);
    const chip = document.createElement("span");
    chip.className = `status-chip status-chip--${statusChipModifier(service.status)}`;
    addText(chip, String(service.status));
    heading.append(document.createTextNode(" "), chip);
    article.append(heading);
    const identity = document.createElement("p");
    addText(
      identity,
      `ID: ${String(service.id)} · Adapter: ${String(service.managementKind)} (diagnostic only) · Availability mode: ${String(service.availability)}`,
    );
    article.append(identity);
    const dependencies = document.createElement("p");
    addText(
      dependencies,
      `Dependencies: ${Array.isArray(service.dependencies) ? service.dependencies.join(", ") || "none" : "unavailable"}`,
    );
    article.append(dependencies);
    const resources = document.createElement("p");
    resources.className = "service-resources";
    addText(resources, resourceObservationSummary(service.resources));
    article.append(resources);
    const unavailableFields = document.createElement("p");
    unavailableFields.className = "field-unavailable";
    addText(
      unavailableFields,
      "Readiness, next transition and dependents are not yet reported by this build.",
    );
    article.append(unavailableFields);
    for (const operation of controlOperationsFor(service)) {
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
    if (supportsLogs(service)) {
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
            if (status !== null)
              status.textContent = "Service logs unavailable.";
          })
          .finally(() => {
            logsButton.disabled = false;
          });
      });
      article.append(logsButton);
    }
    const scheduleLink = document.createElement("a");
    scheduleLink.href = "#schedules";
    addText(scheduleLink, "View schedule");
    article.append(scheduleLink);
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
  let preview = section.querySelector<HTMLElement>("#machine-preview");
  if (preview === null) {
    preview = document.createElement("div");
    preview.id = "machine-preview";
    section.append(preview);
  }
  renderMachinePreviewView(document, preview, value);
}

function renderAvailability(value: readonly unknown[]): void {
  if (availability === null) return;
  availability.replaceChildren();
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
  const list = readRecordArray(value, "targets");
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

function powerControlsHttpError(statusCode: number): PowerControlsRequestError {
  if (statusCode === 401 || statusCode === 403)
    return new PowerControlsRequestError("unauthorized");
  if (statusCode === 409 || statusCode === 429)
    return new PowerControlsRequestError("busy");
  return new PowerControlsRequestError("failed");
}

async function mutatePowerState(
  path: string,
  method: "PUT" | "DELETE" | "POST",
  body: unknown,
): Promise<unknown> {
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
  if (!response.ok) throw powerControlsHttpError(response.status);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new PowerControlsRequestError("invalid_response");
  }
}

const powerControlsController = new PowerControlsController({
  document,
  transport: { read: readJson, mutate: mutatePowerState },
  refresh,
  setStatus: (message) => {
    if (status !== null) status.textContent = message;
  },
});

const apiClient = new AdministrativeApiClient({
  fetch: (path, init) => fetch(path, init),
});

function readServiceList(value: unknown): readonly Record<string, unknown>[] {
  return readRecordArray(value, "services");
}

function readRecordArray(
  value: unknown,
  key: string,
): readonly Record<string, unknown>[] {
  return isRecord(value) && Array.isArray(value[key])
    ? (value[key] as readonly Record<string, unknown>[])
    : [];
}

function failed(result: AdministrativeReadResult): SectionLoadResult {
  return Object.freeze({
    kind: "failed" as const,
    outcome: result.outcome === "success" ? "invalid_response" : result.outcome,
  });
}

// The services list backs both the Services and Schedules sections. Reading it
// once per refresh keeps request volume flat against the administrative
// admission limit; the two sections still settle and fail independently,
// because each interprets the shared outcome on its own.
let sharedServiceListToken = 0;
let sharedServiceList:
  | Readonly<{ token: number; result: Promise<AdministrativeReadResult> }>
  | undefined;

function readServicesOnce(): Promise<AdministrativeReadResult> {
  if (sharedServiceList !== undefined) return sharedServiceList.result;
  const token = ++sharedServiceListToken;
  const result = apiClient.read("/admin/services", hasRecordArray("services"));
  sharedServiceList = Object.freeze({ token, result });
  void result.finally(() => {
    if (sharedServiceList?.token === token) sharedServiceList = undefined;
  });
  return result;
}

async function loadOverview(): Promise<SectionLoadResult> {
  const result = await apiClient.read("/admin/overview", isRecord);
  if (result.outcome !== "success") return failed(result);
  const value = result.value;
  return Object.freeze({
    kind: "ready" as const,
    render: () => {
      renderOverview(value);
      renderMachinePlan(value);
    },
  });
}

async function loadServices(): Promise<SectionLoadResult> {
  const result = await readServicesOnce();
  if (result.outcome !== "success") return failed(result);
  const list = readServiceList(result.value);
  const withResources = await Promise.all(
    list.map(async (service) => {
      const servicePath = encodeURIComponent(String(service.id));
      const resources = await apiClient.read(
        `/admin/services/${servicePath}/resources`,
        isRecord,
      );
      return {
        ...service,
        resources: resources.outcome === "success" ? resources.value : null,
      };
    }),
  );
  const render = () => {
    renderServices({ services: withResources });
  };
  return list.length === 0
    ? Object.freeze({
        kind: "empty" as const,
        message: "No registered services.",
        render,
      })
    : Object.freeze({ kind: "ready" as const, render });
}

async function loadSchedules(): Promise<SectionLoadResult> {
  const result = await readServicesOnce();
  if (result.outcome !== "success") return failed(result);
  const serviceValues = readServiceList(result.value);
  const previewWindow = createPreviewWindow();
  const schedules = await Promise.all(
    serviceValues.map(async (service) => {
      const servicePath = encodeURIComponent(String(service.id));
      const [schedule, availability, preview] = await Promise.all([
        apiClient.read(`/admin/services/${servicePath}/schedule`, isRecord),
        apiClient.read(`/admin/services/${servicePath}/availability`, isRecord),
        apiClient.read(
          `/admin/services/${servicePath}/availability/preview?startsAt=${encodeURIComponent(previewWindow.startsAt)}&endsAt=${encodeURIComponent(previewWindow.endsAt)}`,
          isRecord,
        ),
      ]);
      const policy =
        schedule.outcome === "success"
          ? { value: schedule.value, scheduleEditable: true }
          : {
              value:
                availability.outcome === "success" ? availability.value : null,
              scheduleEditable: false,
            };
      const effectiveAvailability =
        availability.outcome === "success"
          ? readRecord(availability.value).effectiveAvailability
          : undefined;
      return {
        ...(isRecord(policy.value) ? policy.value : {}),
        scheduleEditable: policy.scheduleEditable,
        effectiveAvailability,
        preview: preview.outcome === "success" ? preview.value : null,
      };
    }),
  );
  const render = () => {
    renderAvailability(schedules);
  };
  return schedules.length === 0
    ? Object.freeze({
        kind: "empty" as const,
        message: "No service schedules available.",
        render,
      })
    : Object.freeze({ kind: "ready" as const, render });
}

async function loadEvents(): Promise<SectionLoadResult> {
  const history = await apiClient.read("/admin/event-history?limit=20");
  if (history.outcome !== "success") return failed(history);
  const [integrity, retention, exports] = await Promise.all([
    apiClient.read("/admin/event-history/integrity"),
    apiClient.read("/admin/event-history/retention"),
    apiClient.read("/admin/event-history/exports"),
  ]);
  const value = {
    history: history.value,
    integrity:
      integrity.outcome === "success"
        ? integrity.value
        : { outcome: integrity.outcome },
    retention:
      retention.outcome === "success"
        ? retention.value
        : { outcome: retention.outcome },
    exports:
      exports.outcome === "success"
        ? exports.value
        : { outcome: exports.outcome },
  };
  return Object.freeze({
    kind: "ready" as const,
    render: () => {
      renderAudit(value);
    },
  });
}

async function loadBackups(): Promise<SectionLoadResult> {
  const targets = await apiClient.read(
    "/admin/backups/targets",
    hasRecordArray("targets"),
  );
  if (targets.outcome !== "success") return failed(targets);
  const runs = await apiClient.read("/admin/backups/runs?limit=20");
  const runsValue = runs.outcome === "success" ? runs.value : { runs: [] };
  const targetsValue = targets.value;
  const render = () => {
    renderBackups(targetsValue, runsValue);
  };
  return readRecordArray(targetsValue, "targets").length === 0
    ? Object.freeze({
        kind: "empty" as const,
        message: "No registered backup targets.",
        render,
      })
    : Object.freeze({ kind: "ready" as const, render });
}

async function loadInfrastructure(): Promise<SectionLoadResult> {
  const result = await apiClient.read("/admin/security/status", isRecord);
  if (result.outcome !== "success") return failed(result);
  const value = result.value;
  return Object.freeze({
    kind: "ready" as const,
    render: () => {
      renderInfrastructure(value);
    },
  });
}

function createSection(
  capability: string,
  content: HTMLElement | null,
  load: () => Promise<SectionLoadResult>,
): DashboardSection | undefined {
  if (content === null) return undefined;
  const container = content.closest("section") ?? content.parentElement;
  if (container === null) return undefined;
  const status = new SectionStatusRegion({
    document,
    container,
    capability,
    onRetry: () => {
      void coordinator.refreshCapability(capability);
    },
  });
  return Object.freeze({ capability, status, load });
}

const dashboardSections = [
  createSection("Overview", root, loadOverview),
  createSection("Services", services, loadServices),
  createSection("Schedules", availability, loadSchedules),
  createSection("Events", audit, loadEvents),
  createSection("Backups", backups, loadBackups),
  createSection("Infrastructure", infrastructure, loadInfrastructure),
].filter((section): section is DashboardSection => section !== undefined);

const coordinator = new DashboardRefreshCoordinator(dashboardSections);

async function refresh(): Promise<void> {
  if (refreshButton !== null) refreshButton.disabled = true;
  await coordinator.refresh();
  reportGlobalHealth();
  reportLastRefresh();
  if (refreshButton !== null) refreshButton.disabled = false;
}

function reportGlobalHealth(): void {
  if (healthLabel === null) return;
  const states = dashboardSections.map((section) => section.status.state.kind);
  const label = states.every((kind) => kind === "ready" || kind === "empty")
    ? "Healthy"
    : states.every((kind) => kind === "failed")
      ? "Unavailable"
      : "Degraded";
  healthLabel.textContent = `Health: ${label}`;
}

function reportLastRefresh(): void {
  if (lastRefreshLabel === null) return;
  lastRefreshLabel.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
}

refreshButton?.addEventListener("click", () => {
  void refresh();
});

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

// The coordinator settles every section independently and reports failures in
// each section's own live region, so this can no longer reject as a whole.
void refresh();

// Resource observations (CPU/memory/uptime) are the only card content that
// meaningfully changes between operator-triggered refreshes, so only the
// Services section is polled automatically -- not every card individually,
// and not while the tab is hidden.
const SERVICES_POLL_INTERVAL_MS = 30_000;
let servicesPollTimer: ReturnType<typeof setInterval> | undefined;

function startServicesPolling(): void {
  if (servicesPollTimer !== undefined) return;
  servicesPollTimer = setInterval(() => {
    void coordinator.refreshCapability("Services");
  }, SERVICES_POLL_INTERVAL_MS);
}

function stopServicesPolling(): void {
  if (servicesPollTimer === undefined) return;
  clearInterval(servicesPollTimer);
  servicesPollTimer = undefined;
}

if (document.visibilityState !== "hidden") startServicesPolling();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") stopServicesPolling();
  else startServicesPolling();
});
