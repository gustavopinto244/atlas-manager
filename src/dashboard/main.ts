const root = document.querySelector<HTMLElement>("#app");
const services = document.querySelector<HTMLElement>("#services");
const availability = document.querySelector<HTMLElement>("#availability");
const audit = document.querySelector<HTMLElement>("#audit");

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

const status = document.querySelector<HTMLElement>("#status");
async function refresh(): Promise<void> {
  const [overview, serviceList, history] = await Promise.all([
    readJson("/admin/overview"),
    readJson("/admin/services"),
    readJson("/admin/event-history?limit=20"),
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
}

void refresh().catch(() => {
  if (status !== null)
    status.textContent = "Administrative overview unavailable.";
});
