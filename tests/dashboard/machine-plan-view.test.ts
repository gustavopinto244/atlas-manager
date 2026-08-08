import { describe, expect, it } from "vitest";

import {
  renderMachinePlan,
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
  });

  it("renders an unavailable state without trusting malformed data", () => {
    const parent = new FakeElement();

    renderMachinePlan(fakeDocument(), parent as unknown as HTMLElement, {
      expectation: 42,
    });

    expect(parent.textContent).toContain("Expected state: unavailable");
    expect(parent.textContent).toContain("not planned");
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
});
