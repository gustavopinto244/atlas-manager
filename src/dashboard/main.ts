const root = document.querySelector<HTMLElement>("#app");
const services = document.querySelector<HTMLElement>("#services");
const availability = document.querySelector<HTMLElement>("#availability");
const audit = document.querySelector<HTMLElement>("#audit");
const backups = document.querySelector<HTMLElement>("#backups");

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
    for (const operation of ["start", "stop", "restart"] as const) {
      const form = document.createElement("form");
      form.className = "mutation";
      const label = document.createElement("label");
      addText(label, `${operation} confirmation`);
      const input = document.createElement("input");
      input.type = "text";
      input.required = true;
      input.autocomplete = "off";
      label.append(input);
      const button = document.createElement("button");
      button.type = "submit";
      addText(button, operation);
      form.append(label, button);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        button.disabled = true;
        void fetch(
          `/admin/services/${encodeURIComponent(String(service.id))}/actions/${operation}`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ confirmation: input.value }),
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
    services.append(article);
  }
}

function renderAudit(value: unknown): void {
  if (audit === null) return;
  audit.textContent = "";
  addText(audit, value);
}

function renderAvailability(value: unknown): void {
  if (availability === null) return;
  availability.textContent = "";
  addText(availability, value);
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
  const [overview, serviceList, history, backupTargets, backupRuns] =
    await Promise.all([
      readJson("/admin/overview"),
      readJson("/admin/services"),
      readJson("/admin/event-history?limit=20"),
      readJson("/admin/backups/targets").catch(() => ({ targets: [] })),
      readJson("/admin/backups/runs?limit=20").catch(() => ({ runs: [] })),
    ]);
  const serviceValues =
    typeof serviceList === "object" &&
    serviceList !== null &&
    Array.isArray((serviceList as { services?: unknown }).services)
      ? (serviceList as { services: readonly Record<string, unknown>[] })
          .services
      : [];
  const policies = await Promise.all(
    serviceValues.map((service) =>
      readJson(
        `/admin/services/${encodeURIComponent(String(service.id))}/availability`,
      ),
    ),
  );
  if (root !== null) root.textContent = JSON.stringify(overview, null, 2);
  renderServices(serviceList);
  renderAvailability(policies);
  renderAudit(history);
  renderBackups(backupTargets, backupRuns);
}

void refresh().catch(() => {
  if (status !== null)
    status.textContent = "Administrative overview unavailable.";
});
