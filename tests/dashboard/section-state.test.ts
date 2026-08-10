import { describe, expect, it } from "vitest";

import { SectionStatusRegion } from "../../src/dashboard/section-state.js";

class FakeElement {
  public readonly attributes = new Map<string, string>();
  public children: FakeElement[] = [];
  public className = "";
  public type = "";
  public hidden = false;
  public ownText = "";
  readonly #listeners = new Map<string, (() => void)[]>();

  public constructor(public readonly tagName: string) {}

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children = [...children];
    this.ownText = "";
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public addEventListener(name: string, listener: () => void): void {
    this.#listeners.set(name, [...(this.#listeners.get(name) ?? []), listener]);
  }

  public dispatch(name: string): void {
    for (const listener of this.#listeners.get(name) ?? []) listener();
  }

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

  public get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }
}

function createRegion(onRetry: () => void = () => {}) {
  const container = new FakeElement("section");
  const document = {
    createElement: (tagName: string) => new FakeElement(tagName),
    createTextNode: (value: string) => {
      const node = new FakeElement("#text");
      node.ownText = value;
      return node;
    },
  } as unknown as Document;
  const region = new SectionStatusRegion({
    document,
    container: container as unknown as HTMLElement,
    capability: "Services",
    onRetry,
  });
  return { container, region };
}

describe("SectionStatusRegion", () => {
  it("starts in a loading state announced politely", () => {
    const { container } = createRegion();
    const status = container.children[0];
    expect(status?.attributes.get("role")).toBe("status");
    expect(status?.attributes.get("aria-live")).toBe("polite");
    expect(status?.textContent).toBe("Loading…");
  });

  it("hides itself once the section is ready", () => {
    const { container, region } = createRegion();
    region.set({ kind: "ready" });
    expect(container.children[0]?.hidden).toBe(true);
  });

  it("names the capability and the reason when a read fails", () => {
    const { container, region } = createRegion();
    region.set({ kind: "failed", outcome: "forbidden" });
    const text = container.children[0]?.textContent ?? "";
    expect(text).toContain("Services could not be read.");
    expect(text).toContain("not permitted");
    expect(container.children[0]?.hidden).toBe(false);
  });

  it("distinguishes a stale refresh from a first failure", () => {
    const { container, region } = createRegion();
    region.set({ kind: "stale", outcome: "busy" });
    expect(container.children[0]?.textContent).toContain(
      "Services could not be refreshed; showing the last known state.",
    );
  });

  it("shows an empty message without presenting it as a failure", () => {
    const { container, region } = createRegion();
    region.set({ kind: "empty", message: "No registered services." });
    const status = container.children[0];
    expect(status?.textContent).toBe("No registered services.");
    expect(status?.find((element) => element.tagName === "button")).toBe(
      undefined,
    );
  });

  it("offers a retry control that invokes the section reload", () => {
    let retries = 0;
    const { container, region } = createRegion(() => {
      retries += 1;
    });
    region.set({ kind: "failed", outcome: "unavailable" });
    const retry = container.children[0]?.find(
      (element) => element.tagName === "button",
    );
    expect(retry?.textContent).toBe("Retry");
    retry?.dispatch("click");
    expect(retries).toBe(1);
  });

  it("does not accumulate stale content across transitions", () => {
    const { container, region } = createRegion();
    region.set({ kind: "failed", outcome: "busy" });
    region.set({ kind: "empty", message: "No registered services." });
    expect(container.children[0]?.textContent).toBe("No registered services.");
  });
});
