import { describe, expect, it } from "vitest";

import {
  renderScheduleTimeline,
  SCHEDULE_WEEKDAYS,
} from "../../src/dashboard/schedule-view.js";

class FakeElement {
  public children: FakeElement[] = [];
  public ownText = "";
  public className = "";
  public scope = "";

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
  return { createElement: () => new FakeElement() } as unknown as Document;
}

describe("dashboard schedule view", () => {
  it("uses the domain weekday order for the weekly timeline", () => {
    expect(SCHEDULE_WEEKDAYS).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
  });

  it("renders preview state alongside each service timeline", () => {
    const parent = new FakeElement();
    renderScheduleTimeline(fakeDocument(), parent as unknown as HTMLElement, {
      policy: { mode: "always" },
      preview: {
        outcome: "required",
        firstRequiredAt: "2026-08-08T08:00:00.000Z",
      },
    });

    expect(parent.textContent).toContain("Mode: always");
    expect(parent.textContent).toContain(
      "Preview: required · First required at: 2026-08-08T08:00:00.000Z",
    );
  });

  it("renders the following transitions beneath the preview line", () => {
    const parent = new FakeElement();
    renderScheduleTimeline(fakeDocument(), parent as unknown as HTMLElement, {
      policy: { mode: "scheduled" },
      preview: {
        outcome: "required",
        firstRequiredAt: "2026-08-08T08:00:00.000Z",
        transitions: [
          {
            kind: "became_available",
            scheduledFor: "2026-08-08T08:00:00.000Z",
          },
          {
            kind: "became_unavailable",
            scheduledFor: "2026-08-08T17:00:00.000Z",
          },
        ],
      },
    });

    expect(parent.textContent).toContain(
      "Becomes available: 2026-08-08T08:00:00.000Z",
    );
    expect(parent.textContent).toContain(
      "Becomes unavailable: 2026-08-08T17:00:00.000Z",
    );
  });

  it("omits the transitions list when none are provided", () => {
    const parent = new FakeElement();
    renderScheduleTimeline(fakeDocument(), parent as unknown as HTMLElement, {
      policy: { mode: "always" },
      preview: {
        outcome: "required",
        firstRequiredAt: "2026-08-08T08:00:00.000Z",
      },
    });

    expect(parent.textContent).not.toContain("Becomes");
  });

  it("shows the current effective state and local time when available", () => {
    const parent = new FakeElement();
    renderScheduleTimeline(fakeDocument(), parent as unknown as HTMLElement, {
      policy: { mode: "scheduled", timezone: "America/Sao_Paulo" },
      effectiveAvailability: "available",
    });

    expect(parent.textContent).toContain("Current state: available");
    expect(parent.textContent).toContain("Local time:");
  });

  it("shows an active override with its expiry", () => {
    const parent = new FakeElement();
    renderScheduleTimeline(fakeDocument(), parent as unknown as HTMLElement, {
      policy: { mode: "manual" },
      effectiveAvailability: "available",
      override: {
        kind: "keep_available",
        expiresAt: "2026-08-08T08:00:00.000Z",
      },
    });

    expect(parent.textContent).toContain(
      "Active override: keep_available · Expires at: 2026-08-08T08:00:00.000Z",
    );
  });

  it("omits the override line when there is no active override", () => {
    const parent = new FakeElement();
    renderScheduleTimeline(fakeDocument(), parent as unknown as HTMLElement, {
      policy: { mode: "manual" },
      effectiveAvailability: "available",
      override: null,
    });

    expect(parent.textContent).not.toContain("Active override:");
  });

  it("omits the current-state line when effectiveAvailability is absent", () => {
    const parent = new FakeElement();
    renderScheduleTimeline(fakeDocument(), parent as unknown as HTMLElement, {
      policy: { mode: "always" },
    });

    expect(parent.textContent).not.toContain("Current state:");
  });

  it("falls back to ISO time when the timezone is unknown", () => {
    const parent = new FakeElement();
    renderScheduleTimeline(fakeDocument(), parent as unknown as HTMLElement, {
      policy: { mode: "scheduled", timezone: "Not/AZone" },
      effectiveAvailability: "unavailable",
    });

    expect(parent.textContent).toContain("Current state: unavailable");
    expect(parent.textContent).toMatch(/Local time: \d{4}-\d{2}-\d{2}T/u);
  });
});
