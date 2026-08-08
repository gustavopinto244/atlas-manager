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
});
