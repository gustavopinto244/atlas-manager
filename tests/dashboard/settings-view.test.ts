import { describe, expect, it } from "vitest";

import {
  buildEventHistoryRetentionPolicyRequestBody,
  readEventHistoryRetentionPolicy,
  renderSettings,
  validateEventHistoryRetentionPolicyInput,
} from "../../src/dashboard/settings-view.js";

class FakeElement {
  public className = "";
  public type = "";
  public checked = false;
  public value = "";
  public required = false;
  public disabled = false;
  public ownText = "";
  public children: FakeElement[] = [];
  public attributes: Record<string, string> = {};
  #listeners = new Map<string, ((event: unknown) => void)[]>();

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children = children;
    this.ownText = "";
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
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

  public addEventListener(
    name: string,
    listener: (event: unknown) => void,
  ): void {
    const existing = this.#listeners.get(name) ?? [];
    existing.push(listener);
    this.#listeners.set(name, existing);
  }

  public dispatch(name: string, event: unknown): void {
    for (const listener of this.#listeners.get(name) ?? []) listener(event);
  }

  public descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  public querySelectorAll(): FakeElement[] {
    return [];
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
    defaultView: { confirm: () => true },
  } as unknown as Document;
}

const VALID_INPUT = Object.freeze({
  automaticPruneEnabled: true,
  minSealedSegments: 2,
  maxSealedSegments: 50,
  maxSealedSegmentAgeDays: 180,
  minExports: 1,
  maxExports: 20,
  maxExportAgeDays: 60,
});

describe("readEventHistoryRetentionPolicy", () => {
  it("reads a full GET /admin/event-history/retention response", () => {
    const response = {
      policy: {
        automaticPruneEnabled: true,
        segments: {
          minSealedSegments: 2,
          maxSealedSegments: 50,
          maxSealedSegmentAgeDays: 180,
        },
        exports: { minExports: 1, maxExports: 20, maxExportAgeDays: 60 },
      },
    };
    expect(readEventHistoryRetentionPolicy(response)).toEqual(VALID_INPUT);
  });

  it("reads a bare policy object (the PUT response shape)", () => {
    const policy = {
      automaticPruneEnabled: false,
      segments: {
        minSealedSegments: 1,
        maxSealedSegments: 100,
        maxSealedSegmentAgeDays: 365,
      },
      exports: { minExports: 0, maxExports: 32, maxExportAgeDays: 90 },
    };
    expect(readEventHistoryRetentionPolicy(policy)).toEqual({
      automaticPruneEnabled: false,
      minSealedSegments: 1,
      maxSealedSegments: 100,
      maxSealedSegmentAgeDays: 365,
      minExports: 0,
      maxExports: 32,
      maxExportAgeDays: 90,
    });
  });

  it("falls back to server defaults for missing or malformed fields", () => {
    expect(readEventHistoryRetentionPolicy(undefined)).toEqual({
      automaticPruneEnabled: false,
      minSealedSegments: 1,
      maxSealedSegments: 100,
      maxSealedSegmentAgeDays: 365,
      minExports: 0,
      maxExports: 32,
      maxExportAgeDays: 90,
    });
    expect(
      readEventHistoryRetentionPolicy({
        policy: { automaticPruneEnabled: "yes", segments: null, exports: 5 },
      }),
    ).toEqual({
      automaticPruneEnabled: false,
      minSealedSegments: 1,
      maxSealedSegments: 100,
      maxSealedSegmentAgeDays: 365,
      minExports: 0,
      maxExports: 32,
      maxExportAgeDays: 90,
    });
  });
});

describe("validateEventHistoryRetentionPolicyInput", () => {
  it("accepts a valid policy", () => {
    expect(validateEventHistoryRetentionPolicyInput(VALID_INPUT)).toBeNull();
  });

  it("rejects out-of-bounds values", () => {
    expect(
      validateEventHistoryRetentionPolicyInput({
        ...VALID_INPUT,
        minSealedSegments: 0,
      }),
    ).toContain("Minimum sealed segments");
    expect(
      validateEventHistoryRetentionPolicyInput({
        ...VALID_INPUT,
        maxExportAgeDays: 5_000,
      }),
    ).toContain("Maximum export age");
  });

  it("rejects a max below its min", () => {
    expect(
      validateEventHistoryRetentionPolicyInput({
        ...VALID_INPUT,
        minSealedSegments: 10,
        maxSealedSegments: 5,
      }),
    ).toContain("Maximum sealed segments cannot be less than the minimum.");
    expect(
      validateEventHistoryRetentionPolicyInput({
        ...VALID_INPUT,
        minExports: 10,
        maxExports: 5,
      }),
    ).toContain("Maximum exports cannot be less than the minimum.");
  });
});

describe("buildEventHistoryRetentionPolicyRequestBody", () => {
  it("builds the exact request shape the server's exactPolicy() parser expects", () => {
    const body = buildEventHistoryRetentionPolicyRequestBody(VALID_INPUT);
    expect(body).toEqual({
      confirmation: "confirm_administrative_event_history_retention_update",
      policy: {
        schemaVersion: 1,
        automaticPruneEnabled: true,
        segments: {
          minSealedSegments: 2,
          maxSealedSegments: 50,
          maxSealedSegmentAgeDays: 180,
        },
        exports: { minExports: 1, maxExports: 20, maxExportAgeDays: 60 },
      },
    });
  });
});

describe("renderSettings", () => {
  it("renders a summary and a form seeded from the current policy", () => {
    const parent = new FakeElement();
    renderSettings(
      fakeDocument(),
      parent as unknown as HTMLElement,
      {
        policy: {
          automaticPruneEnabled: true,
          segments: {
            minSealedSegments: 2,
            maxSealedSegments: 50,
            maxSealedSegmentAgeDays: 180,
          },
          exports: { minExports: 1, maxExports: 20, maxExportAgeDays: 60 },
        },
        retainedEventCount: 42,
        sealedSegmentCount: 3,
        eligibleSegmentCount: 1,
        exportCount: 2,
        eligibleExportCount: 0,
        earliestRetainedSequence: 1,
        latestSequence: 42,
      },
      async () => {},
    );
    const text = parent.textContent;
    expect(text).toContain("Settings");
    expect(text).toContain("Retained events: 42");
    const checkbox = parent
      .descendants()
      .find((element) => element.type === "checkbox");
    expect(checkbox?.checked).toBe(true);
    const numberInputs = parent
      .descendants()
      .filter((element) => element.type === "number");
    expect(numberInputs).toHaveLength(6);
    expect(numberInputs.map((input) => input.value)).toEqual([
      "2",
      "50",
      "180",
      "1",
      "20",
      "60",
    ]);
  });

  it("renders server-default fields when no policy is present yet", () => {
    const parent = new FakeElement();
    renderSettings(
      fakeDocument(),
      parent as unknown as HTMLElement,
      undefined,
      async () => {},
    );
    const numberInputs = parent
      .descendants()
      .filter((element) => element.type === "number");
    expect(numberInputs.map((input) => input.value)).toEqual([
      "1",
      "100",
      "365",
      "0",
      "32",
      "90",
    ]);
  });
});
