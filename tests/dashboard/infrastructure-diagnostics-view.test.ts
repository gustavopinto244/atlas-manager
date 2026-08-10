import { describe, expect, it } from "vitest";

import {
  renderInfrastructureDiagnostics,
  statusChipLabelForDiagnostic,
  statusChipModifierForDiagnostic,
} from "../../src/dashboard/infrastructure-diagnostics-view.js";

class FakeElement {
  public className = "";
  public ownText = "";
  public children: FakeElement[] = [];
  public attributes: Record<string, string> = {};

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children = children;
    this.ownText = "";
  }

  public set textContent(value: string) {
    this.ownText = value;
    this.children = [];
  }

  public get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }

  public descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

function fakeDocument(): Document {
  return {
    createElement: () => new FakeElement(),
    createTextNode: (value: string) => {
      const node = new FakeElement();
      node.textContent = value;
      return node;
    },
  } as unknown as Document;
}

function render(value: unknown): FakeElement {
  const parent = new FakeElement();
  renderInfrastructureDiagnostics(
    fakeDocument(),
    parent as unknown as HTMLElement,
    value,
  );
  return parent;
}

function chips(parent: FakeElement): FakeElement[] {
  return parent
    .descendants()
    .filter((element) => element.className.startsWith("status-chip "));
}

function checkRows(parent: FakeElement): FakeElement[] {
  return parent
    .descendants()
    .filter((element) => element.className === "diagnostic-check");
}

const OBSERVED_AT = "2026-02-02T10:00:00.000Z";

describe("diagnostic status chips", () => {
  it("maps each status to its own chip class", () => {
    expect(statusChipModifierForDiagnostic("ok")).toBe("online");
    expect(statusChipModifierForDiagnostic("degraded")).toBe("degraded");
    expect(statusChipModifierForDiagnostic("down")).toBe("unavailable");
    expect(statusChipModifierForDiagnostic("unavailable")).toBe(
      "indeterminate",
    );
    expect(statusChipModifierForDiagnostic("disabled")).toBe("disabled");
  });

  // "could not determine" and "is broken" must never look the same.
  it("keeps an undetermined diagnostic visually distinct from an outage", () => {
    expect(statusChipModifierForDiagnostic("unavailable")).not.toBe(
      statusChipModifierForDiagnostic("down"),
    );
  });

  it("falls back to indeterminate for an unrecognized status", () => {
    expect(statusChipModifierForDiagnostic("wat")).toBe("indeterminate");
    expect(statusChipModifierForDiagnostic(undefined)).toBe("indeterminate");
  });

  it("labels each status for assistive technology", () => {
    expect(statusChipLabelForDiagnostic("disabled")).toBe(
      "intentionally disabled",
    );
    expect(statusChipLabelForDiagnostic("unavailable")).toBe(
      "diagnostic unavailable",
    );
  });
});

describe("renderInfrastructureDiagnostics", () => {
  // The dashboard half of the partial-failure obligation: one failing check
  // must not suppress the rows around it.
  it("renders a down check and an ok check as independent rows", () => {
    const parent = render({
      generatedAt: OBSERVED_AT,
      overallStatus: "down",
      checks: [
        { id: "atlas.service", status: "down", observedAt: OBSERVED_AT },
        { id: "nginx.service", status: "ok", observedAt: OBSERVED_AT },
      ],
    });
    expect(checkRows(parent)).toHaveLength(2);
    expect(parent.textContent).toContain("atlas.service");
    expect(parent.textContent).toContain("nginx.service");
  });

  it("keeps rendering every other row when one entry is malformed", () => {
    const parent = render({
      generatedAt: OBSERVED_AT,
      overallStatus: "down",
      checks: [
        { id: "atlas.service", status: "ok", observedAt: OBSERVED_AT },
        null,
        "nonsense",
        { id: "nginx.config", status: "down", observedAt: OBSERVED_AT },
      ],
    });
    expect(checkRows(parent)).toHaveLength(4);
    expect(parent.textContent).toContain("atlas.service");
    expect(parent.textContent).toContain("nginx.config");
    expect(parent.textContent).toContain("unknown check");
  });

  it("never gives a disabled check an outage or degradation class", () => {
    const parent = render({
      generatedAt: OBSERVED_AT,
      overallStatus: "disabled",
      checks: [
        { id: "power.posture", status: "disabled", observedAt: OBSERVED_AT },
      ],
    });
    const classes = chips(parent).map((chip) => chip.className);
    for (const className of classes) {
      expect(className).not.toContain("status-chip--unavailable");
      expect(className).not.toContain("status-chip--degraded");
      expect(className).not.toContain("status-chip--offline");
    }
    expect(classes.some((c) => c.includes("status-chip--disabled"))).toBe(true);
  });

  it("surfaces a privilege gap plainly, without offering to elevate", () => {
    const parent = render({
      generatedAt: OBSERVED_AT,
      overallStatus: "unavailable",
      checks: [
        {
          id: "atlas.service",
          status: "unavailable",
          errorCode: "systemd_permission_denied",
          requiresPrivilege: true,
          observedAt: OBSERVED_AT,
        },
      ],
    });
    expect(parent.textContent).toContain("systemd_permission_denied");
    expect(parent.textContent).toContain("lacks the privilege");
    expect(parent.textContent.toLowerCase()).not.toContain("sudo");
    expect(parent.textContent.toLowerCase()).not.toContain("elevate");
  });

  // Diagnostics are observation only, permanently (ADR-032 section 12).
  it("offers no repair control of any kind", () => {
    const parent = render({
      generatedAt: OBSERVED_AT,
      overallStatus: "down",
      checks: [
        { id: "nginx.service", status: "down", observedAt: OBSERVED_AT },
      ],
    });
    const text = parent.textContent.toLowerCase();
    for (const verb of ["restart", "reload", "enable", "start", "fix"])
      expect(text, verb).not.toContain(verb);
    expect(
      parent.descendants().some((element) => element.className === "button"),
    ).toBe(false);
  });

  it("renders the observed detail fields it was given", () => {
    const parent = render({
      generatedAt: OBSERVED_AT,
      overallStatus: "degraded",
      checks: [
        {
          id: "listener.atlas",
          status: "degraded",
          observed: "wildcard :3000",
          expected: "loopback :3000",
          observedAt: OBSERVED_AT,
        },
      ],
    });
    expect(parent.textContent).toContain("observed wildcard :3000");
    expect(parent.textContent).toContain("expected loopback :3000");
  });

  it("states the nginx scope boundary so it is not read as ingress validation", () => {
    const parent = render({
      generatedAt: OBSERVED_AT,
      overallStatus: "ok",
      checks: [],
    });
    expect(parent.textContent).toContain("not that requests are routed");
  });

  it("distinguishes an unreadable report from an empty one", () => {
    expect(render(undefined).textContent).toContain("could not be read");
    expect(
      render({ generatedAt: OBSERVED_AT, overallStatus: "ok", checks: [] })
        .textContent,
    ).toContain("No diagnostic checks were reported");
  });

  it("shows the overall status the server derived, not one it recomputes", () => {
    const parent = render({
      generatedAt: OBSERVED_AT,
      // Deliberately inconsistent with the checks below: the dashboard renders
      // what the server decided and never second-guesses it.
      overallStatus: "degraded",
      checks: [{ id: "atlas.service", status: "ok", observedAt: OBSERVED_AT }],
    });
    expect(parent.textContent).toContain("Overall: degraded");
  });
});
