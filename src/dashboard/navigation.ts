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

export function initializeDashboardNavigation(
  document: Document,
  initialPage?: DashboardPage,
): void {
  const main = document.querySelector("main");
  if (main === null) return;
  const navigation = document.createElement("nav");
  navigation.className = "dashboard-navigation";
  navigation.setAttribute("aria-label", "Administrative sections");
  for (const [page, label] of DASHBOARD_PAGES) {
    const link = document.createElement("a");
    link.href = `#${page}`;
    link.dataset.page = page;
    link.textContent = label;
    link.addEventListener("click", () => showDashboardPage(document, page));
    navigation.append(link);
  }
  main.prepend(navigation);
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
  showDashboardPage(
    document,
    initialPage ?? dashboardPageFromHash(document.defaultView?.location.hash),
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
): void {
  const visible = new Set(SECTION_BY_PAGE[page]);
  for (const section of document.querySelectorAll<HTMLElement>(
    "main > section",
  )) {
    const id = section.getAttribute("aria-labelledby") ?? section.id;
    section.hidden = !visible.has(id);
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    ".dashboard-navigation a",
  )) {
    const active = link.dataset.page === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
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
