import { describe, expect, it } from "vitest";

import {
  DASHBOARD_PAGES,
  initializeDashboardNavigation,
  showDashboardPage,
} from "../../src/dashboard/navigation.js";

class FakeElement {
  public children: FakeElement[] = [];
  public className = "";
  public hidden = false;
  public focused = false;
  public href = "";
  public textContent = "";
  public readonly dataset: Record<string, string> = {};
  public readonly attributes = new Map<string, string>();
  readonly #listeners = new Map<string, (() => void)[]>();

  public constructor(
    public readonly tagName: string,
    public id = "",
  ) {}

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children = [...children];
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public addEventListener(name: string, listener: () => void): void {
    this.#listeners.set(name, [...(this.#listeners.get(name) ?? []), listener]);
  }

  public dispatch(name: string): void {
    for (const listener of this.#listeners.get(name) ?? []) listener();
  }

  public focus(): void {
    this.focused = true;
  }

  public readonly classList = {
    toggle: (name: string, force?: boolean): void => {
      const has = this.className.split(" ").includes(name);
      const next = force ?? !has;
      const names = new Set(this.className.split(" ").filter(Boolean));
      if (next) names.add(name);
      else names.delete(name);
      this.className = [...names].join(" ");
    },
    remove: (name: string): void => {
      this.className = this.className
        .split(" ")
        .filter((value) => value !== name)
        .join(" ");
    },
    contains: (name: string): boolean =>
      this.className.split(" ").includes(name),
  };

  public find(
    predicate: (element: FakeElement) => boolean,
  ): FakeElement | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  public findAll(predicate: (element: FakeElement) => boolean): FakeElement[] {
    const result: FakeElement[] = [];
    if (predicate(this)) result.push(this);
    for (const child of this.children) result.push(...child.findAll(predicate));
    return result;
  }
}

function createFixture() {
  const main = new FakeElement("main");
  main.id = "dashboard-main";
  const overview = new FakeElement("section");
  overview.setAttribute("aria-labelledby", "overview-heading");
  const services = new FakeElement("section");
  services.setAttribute("aria-labelledby", "services-heading");
  main.append(overview, services);

  const sidebar = new FakeElement("nav");
  sidebar.id = "dashboard-sidebar";

  const shell = new FakeElement("div");
  shell.className = "dashboard-shell";

  const toggle = new FakeElement("button");
  toggle.className = "dashboard-nav-toggle";

  const scrim = new FakeElement("div");
  scrim.className = "dashboard-scrim";

  const status = new FakeElement("p");
  status.id = "status";

  const registry = new Map<string, FakeElement>([
    ["main", main],
    ["#dashboard-sidebar", sidebar],
    [".dashboard-shell", shell],
    [".dashboard-nav-toggle", toggle],
    [".dashboard-scrim", scrim],
    ["#status", status],
  ]);

  const document = {
    querySelector: (selector: string) => registry.get(selector) ?? null,
    querySelectorAll: (selector: string) => {
      if (selector === "main > section") return main.children;
      if (selector === "#dashboard-sidebar a")
        return sidebar
          .findAll((el) => el.tagName === "a")
          .filter((el) => el !== sidebar);
      return [];
    },
    getElementById: (id: string) => main.find((el) => el.id === id) ?? null,
    createElement: (tagName: string) => new FakeElement(tagName),
    addEventListener: () => {},
    defaultView: {
      location: { hash: "" },
      addEventListener: () => {},
    },
  };

  return {
    document,
    main,
    overview,
    services,
    sidebar,
    shell,
    toggle,
    scrim,
    status,
  };
}

describe("dashboard navigation contract", () => {
  it("exposes the planned operational sections in stable order", () => {
    expect(DASHBOARD_PAGES.map(([page]) => page)).toEqual([
      "overview",
      "services",
      "schedules",
      "machine",
      "backups",
      "events",
      "infrastructure",
      "settings",
    ]);
  });

  it("populates the sidebar with one link per page and marks the active one", () => {
    const fixture = createFixture();
    initializeDashboardNavigation(fixture.document as never, "services");
    expect(fixture.sidebar.children).toHaveLength(DASHBOARD_PAGES.length);
    const activeLink = fixture.sidebar.children.find(
      (link) => link.dataset["page"] === "services",
    );
    expect(activeLink?.getAttribute("aria-current")).toBe("page");
    const inactiveLink = fixture.sidebar.children.find(
      (link) => link.dataset["page"] === "overview",
    );
    expect(inactiveLink?.getAttribute("aria-current")).toBeNull();
  });

  it("shows only the section for the active page", () => {
    const fixture = createFixture();
    initializeDashboardNavigation(fixture.document as never, "services");
    expect(fixture.overview.hidden).toBe(true);
    expect(fixture.services.hidden).toBe(false);
  });

  it("moves focus to main and announces the page change by default", () => {
    const fixture = createFixture();
    initializeDashboardNavigation(fixture.document as never, "overview");
    fixture.main.focused = false;
    showDashboardPage(fixture.document as never, "services");
    expect(fixture.main.focused).toBe(true);
    expect(fixture.status.textContent).toBe("Viewing Services.");
  });

  it("does not steal focus on the very first render", () => {
    const fixture = createFixture();
    initializeDashboardNavigation(fixture.document as never, "overview");
    expect(fixture.main.focused).toBe(false);
  });

  it("opens and closes the mobile navigation drawer", () => {
    const fixture = createFixture();
    initializeDashboardNavigation(fixture.document as never, "overview");
    fixture.toggle.dispatch("click");
    expect(fixture.shell.classList.contains("nav-open")).toBe(true);
    expect(fixture.toggle.getAttribute("aria-expanded")).toBe("true");
    fixture.scrim.dispatch("click");
    expect(fixture.shell.classList.contains("nav-open")).toBe(false);
    expect(fixture.toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the drawer on navigation", () => {
    const fixture = createFixture();
    initializeDashboardNavigation(fixture.document as never, "overview");
    fixture.toggle.dispatch("click");
    expect(fixture.shell.classList.contains("nav-open")).toBe(true);
    showDashboardPage(fixture.document as never, "services");
    expect(fixture.shell.classList.contains("nav-open")).toBe(false);
  });

  it("does nothing when the sidebar or main element is missing", () => {
    const document = {
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: (tagName: string) => new FakeElement(tagName),
      addEventListener: () => {},
      defaultView: { location: { hash: "" }, addEventListener: () => {} },
    };
    expect(() =>
      initializeDashboardNavigation(document as never),
    ).not.toThrow();
  });
});
