import { describe, expect, it } from "vitest";

import {
  renderMachinePlan,
  renderMachinePreview,
  renderMachineSchedule,
} from "../../src/dashboard/machine-plan-view.js";

class FakeElement {
  public className = "";
  public id = "";
  public scope = "";
  public children: FakeElement[] = [];
  public ownText = "";

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public setAttribute(): void {
    // The view uses attributes for accessibility semantics.
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
}

function fakeDocument(): Document {
  return {
    createElement: () => new FakeElement(),
  } as unknown as Document;
}

describe("machine plan view", () => {
  it("renders the authoritative expectation and transitions", () => {
    const parent = new FakeElement();

    renderMachinePlan(fakeDocument(), parent as unknown as HTMLElement, {
      evaluatedAt: "2026-08-08T12:00:00.000Z",
      expectation: "operating",
      nextShutdown: {
        state: "planned",
        scheduledFor: "2026-08-08T23:00:00.000Z",
      },
      nextWake: { state: "planned", scheduledFor: "2026-08-09T07:00:00.000Z" },
    });

    expect(parent.textContent).toContain("Expected state: operating");
    expect(parent.textContent).toContain("Next shutdown");
    expect(parent.textContent).toContain("2026-08-08T23:00:00.000Z");
    expect(parent.textContent).toContain(
      "Next transition: shutdown at 2026-08-08T23:00:00.000Z",
    );
  });

  it("renders an unavailable state without trusting malformed data", () => {
    const parent = new FakeElement();

    renderMachinePlan(fakeDocument(), parent as unknown as HTMLElement, {
      expectation: 42,
    });

    expect(parent.textContent).toContain("Expected state: unavailable");
    expect(parent.textContent).toContain("not planned");
    expect(parent.textContent).toContain("Next transition: not planned");
  });

  it("renders the validated weekly machine schedule", () => {
    const parent = new FakeElement();

    renderMachineSchedule(fakeDocument(), parent as unknown as HTMLElement, {
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }],
      },
    });

    expect(parent.textContent).toContain("Mode: scheduled");
    expect(parent.textContent).toContain("monday");
    expect(parent.textContent).toContain("08:00 → 18:00");
  });

  it("explains non-scheduled machine modes explicitly", () => {
    const alwaysOn = new FakeElement();
    renderMachineSchedule(fakeDocument(), alwaysOn as unknown as HTMLElement, {
      mode: "always_on",
    });
    expect(alwaysOn.textContent).toContain("all day");

    const manual = new FakeElement();
    renderMachineSchedule(fakeDocument(), manual as unknown as HTMLElement, {
      mode: "manual",
    });
    expect(manual.textContent).toContain("operator control is required");
  });

  it("renders a simulation-only machine preview from authoritative safety data", () => {
    const parent = new FakeElement();

    renderMachinePreview(fakeDocument(), parent as unknown as HTMLElement, {
      powerSafety: {
        backend: "mock",
        effects: "disabled",
        machineScheduler: "disabled",
      },
      machineSchedule: { mode: "scheduled" },
    });

    expect(parent.textContent).toContain("Machine preview");
    expect(parent.textContent).toContain("simulation-only");
    expect(parent.textContent).toContain("Mode: scheduled");
  });
});
