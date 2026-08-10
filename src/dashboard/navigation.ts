export const DASHBOARD_PAGES = Object.freeze([
  ["overview", "Overview"],
  ["services", "Services"],
  ["schedules", "Schedules"],
  ["machine", "Machine"],
  ["backups", "Backups"],
  ["events", "Events"],
  ["infrastructure", "Infrastructure"],
  ["settings", "Settings"],
] as const);

export type DashboardPage = (typeof DASHBOARD_PAGES)[number][0];

const SECTION_BY_PAGE: Readonly<Record<DashboardPage, readonly string[]>> =
  Object.freeze({
    overview: ["overview-heading"],
    services: ["services-heading"],
    schedules: ["availability-heading"],
    machine: ["safety-heading"],
    backups: ["backup-heading"],
    events: ["audit-heading"],
    infrastructure: ["infrastructure-placeholder"],
    settings: ["settings-placeholder"],
  });

const PAGE_LABEL: Readonly<Record<DashboardPage, string>> = Object.freeze(
  Object.fromEntries(DASHBOARD_PAGES) as Record<DashboardPage, string>,
);

export function initializeDashboardNavigation(
  document: Document,
  initialPage?: DashboardPage,
): void {
  const sidebar = document.querySelector<HTMLElement>("#dashboard-sidebar");
  const main = document.querySelector<HTMLElement>("main");
  if (sidebar === null || main === null) return;

  sidebar.replaceChildren();
  for (const [page, label] of DASHBOARD_PAGES) {
    const link = document.createElement("a");
    link.href = `#${page}`;
    link.dataset.page = page;
    link.textContent = label;
    link.addEventListener("click", () => closeMobileNavigation(document));
    sidebar.append(link);
  }

  ensurePlaceholderSection(
    document,
    "infrastructure-placeholder",
    "Infrastructure",
    "Runtime diagnostics will be connected in the infrastructure adapter phase.",
  );
  ensurePlaceholderSection(
    document,
    "settings-placeholder",
    "Settings",
    "Settings remain server-owned and protected by the administrative API.",
  );

  initializeMobileNavigationToggle(document);

  showDashboardPage(
    document,
    initialPage ?? dashboardPageFromHash(document.defaultView?.location.hash),
    { focusMain: false },
  );
  document.defaultView?.addEventListener("hashchange", () => {
    showDashboardPage(
      document,
      dashboardPageFromHash(document.defaultView?.location.hash),
    );
  });
}

export function showDashboardPage(
  document: Document,
  page: DashboardPage,
  options?: { readonly focusMain?: boolean },
): void {
  const visible = new Set(SECTION_BY_PAGE[page]);
  for (const section of document.querySelectorAll<HTMLElement>(
    "main > section",
  )) {
    const id = section.getAttribute("aria-labelledby") ?? section.id;
    section.hidden = !visible.has(id);
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "#dashboard-sidebar a",
  )) {
    const active = link.dataset.page === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  closeMobileNavigation(document);
  if (options?.focusMain !== false) {
    const main = document.querySelector<HTMLElement>("main");
    main?.focus();
  }
  announcePageChange(document, PAGE_LABEL[page]);
}

function announcePageChange(document: Document, label: string): void {
  const status = document.querySelector<HTMLElement>("#status");
  if (status === null) return;
  status.textContent = `Viewing ${label}.`;
}

function initializeMobileNavigationToggle(document: Document): void {
  const shell = document.querySelector<HTMLElement>(".dashboard-shell");
  const toggle = document.querySelector<HTMLButtonElement>(
    ".dashboard-nav-toggle",
  );
  const scrim = document.querySelector<HTMLElement>(".dashboard-scrim");
  if (shell === null || toggle === null) return;
  toggle.addEventListener("click", () => {
    const open = !shell.classList.contains("nav-open");
    shell.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  scrim?.addEventListener("click", () => closeMobileNavigation(document));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNavigation(document);
  });
}

function closeMobileNavigation(document: Document): void {
  const shell = document.querySelector<HTMLElement>(".dashboard-shell");
  const toggle = document.querySelector<HTMLButtonElement>(
    ".dashboard-nav-toggle",
  );
  if (shell === null) return;
  shell.classList.remove("nav-open");
  toggle?.setAttribute("aria-expanded", "false");
}

function ensurePlaceholderSection(
  document: Document,
  id: string,
  headingText: string,
  description: string,
): void {
  if (document.getElementById(id) !== null) return;
  const section = document.createElement("section");
  section.id = id;
  const heading = document.createElement("h2");
  heading.textContent = headingText;
  const paragraph = document.createElement("p");
  paragraph.textContent = description;
  section.append(heading, paragraph);
  document.querySelector("main")?.append(section);
}

function dashboardPageFromHash(value: string | undefined): DashboardPage {
  const candidate = value?.replace(/^#/, "");
  return DASHBOARD_PAGES.some(([page]) => page === candidate)
    ? (candidate as DashboardPage)
    : "overview";
}
