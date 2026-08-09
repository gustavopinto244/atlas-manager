import { describe, expect, it, vi } from "vitest";

import {
  PowerControlsController,
  PowerControlsRequestError,
  type PowerControlsTransport,
} from "../../src/dashboard/power-controls.js";

class FakeElement {
  public readonly attributes = new Map<string, string>();
  public readonly children: FakeElement[] = [];
  public className = "";
  public checked = false;
  public disabled = false;
  public required = false;
  public type = "";
  public value = "";
  public ownText = "";
  readonly #listeners = new Map<
    string,
    ((event: Readonly<{ preventDefault(): void }>) => void)[]
  >();

  public constructor(public readonly tagName: string) {}

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
    this.ownText = "";
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public addEventListener(
    name: string,
    listener: (event: Readonly<{ preventDefault(): void }>) => void,
  ): void {
    const listeners = this.#listeners.get(name) ?? [];
    listeners.push(listener);
    this.#listeners.set(name, listeners);
  }

  public dispatch(name: string): void {
    for (const listener of this.#listeners.get(name) ?? [])
      listener({ preventDefault() {} });
  }

  public findText(value: string): FakeElement | undefined {
    if (this.ownText === value) return this;
    for (const child of this.children) {
      const result = child.findText(value);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  public findAttribute(name: string, value: string): FakeElement | undefined {
    if (this.attributes.get(name) === value) return this;
    for (const child of this.children) {
      const result = child.findAttribute(name, value);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  public set textContent(value: string) {
    this.ownText = value;
    this.children.splice(0);
  }

  public get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }
}

function fakeDocument(): Document {
  return {
    createElement: (name: string) => new FakeElement(name),
    createTextNode: (value: string) => {
      const node = new FakeElement("#text");
      node.textContent = value;
      return node;
    },
  } as unknown as Document;
}

function createController(
  transport: PowerControlsTransport,
  statuses: string[] = [],
): Readonly<{
  controller: PowerControlsController;
  refresh: ReturnType<typeof vi.fn>;
}> {
  const refresh = vi.fn(async () => undefined);
  return {
    controller: new PowerControlsController({
      document: fakeDocument(),
      transport,
      refresh,
      setStatus: (message) => statuses.push(message),
      now: () => new Date("2026-08-09T12:00:00.000Z"),
    }),
    refresh,
  };
}

const safety = {
  backend: "mock",
  effects: "disabled",
  machineScheduler: "disabled",
};

describe("dashboard power controls", () => {
  it("renders the authoritative disabled state without making requests", async () => {
    const transport = {
      read: vi.fn(async () => ({})),
      mutate: vi.fn(async () => ({})),
    };
    const { controller } = createController(transport);
    const parent = new FakeElement("section");

    await controller.render(parent as unknown as HTMLElement, {}, safety);

    expect(parent.textContent).toContain("Backend: mock");
    expect(parent.textContent).toContain("disabled by configuration");
    expect(transport.read).not.toHaveBeenCalled();
    expect(transport.mutate).not.toHaveBeenCalled();
  });

  it("exposes loading and then renders a valid wake-alarm response", async () => {
    let resolveRead: ((value: unknown) => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const { controller } = createController({
      read,
      mutate: vi.fn(async () => ({})),
    });
    const parent = new FakeElement("section");

    const rendered = controller.render(
      parent as unknown as HTMLElement,
      { wakeAlarmEnabled: true },
      safety,
    );
    expect(parent.textContent).toContain("Current wake alarm: loading…");

    resolveRead?.({
      wakeAlarm: {
        state: "scheduled",
        scheduledFor: "2026-08-10T10:00:00.000Z",
      },
    });
    await rendered;
    expect(parent.textContent).toContain(
      "Current wake alarm: scheduled at 2026-08-10T10:00:00.000Z",
    );
  });

  it("distinguishes unauthorized and malformed wake-alarm responses", async () => {
    const unauthorized = createController({
      read: vi.fn(async () => {
        throw new PowerControlsRequestError("unauthorized");
      }),
      mutate: vi.fn(async () => ({})),
    }).controller;
    const unauthorizedParent = new FakeElement("section");
    await unauthorized.render(
      unauthorizedParent as unknown as HTMLElement,
      { wakeAlarmEnabled: true },
      safety,
    );
    expect(unauthorizedParent.textContent).toContain(
      "Current wake alarm: unauthorized",
    );

    const malformed = createController({
      read: vi.fn(async () => ({ wakeAlarm: { state: "scheduled" } })),
      mutate: vi.fn(async () => ({})),
    }).controller;
    const malformedParent = new FakeElement("section");
    await malformed.render(
      malformedParent as unknown as HTMLElement,
      { wakeAlarmEnabled: true },
      safety,
    );
    expect(malformedParent.textContent).toContain(
      "Current wake alarm: invalid response",
    );
  });

  it("reports a busy wake mutation without assuming state", async () => {
    const statuses: string[] = [];
    const mutate = vi.fn(async () => {
      throw new PowerControlsRequestError("busy");
    });
    const { controller, refresh } = createController(
      {
        read: vi.fn(async () => ({
          wakeAlarm: { state: "not_scheduled" },
        })),
        mutate,
      },
      statuses,
    );
    const parent = new FakeElement("section");
    await controller.render(
      parent as unknown as HTMLElement,
      { wakeAlarmEnabled: true },
      safety,
    );
    const input = parent.findAttribute("aria-label", "Mock wake time");
    expect(input).toBeDefined();
    const localWakeTime = "2026-08-10T08:00";
    if (input !== undefined) input.value = localWakeTime;
    const schedule = parent.findText("Schedule mock wake");
    expect(schedule).toBeDefined();
    const form = parent.children.find((child) => child.tagName === "form");
    form?.dispatch("submit");
    await controller.settle();

    expect(mutate).toHaveBeenCalledWith("/admin/power/wake-alarm", "PUT", {
      scheduledFor: new Date(localWakeTime).toISOString(),
    });
    expect(statuses.at(-1)).toMatch(/^Busy:/u);
    expect(refresh).not.toHaveBeenCalled();
    expect(schedule?.disabled).toBe(false);
  });

  it("requires confirmation and rejects malformed shutdown preparation", async () => {
    const statuses: string[] = [];
    const mutate = vi.fn(async () => ({
      occurrence: { operation: "shutdown" },
    }));
    const { controller, refresh } = createController(
      { read: vi.fn(async () => ({})), mutate },
      statuses,
    );
    const parent = new FakeElement("section");
    await controller.render(
      parent as unknown as HTMLElement,
      { shutdownEnabled: true },
      safety,
    );
    const form = parent.children.find((child) => child.tagName === "form");
    form?.dispatch("submit");
    expect(parent.textContent).toContain("Explicit confirmation is required.");
    expect(mutate).not.toHaveBeenCalled();

    const confirmation = parent.findAttribute(
      "aria-label",
      "Confirm mock shutdown preparation",
    );
    if (confirmation !== undefined) confirmation.checked = true;
    form?.dispatch("submit");
    await controller.settle();

    expect(mutate).toHaveBeenCalledWith(
      "/admin/power/shutdown/preparations",
      "POST",
      expect.objectContaining({
        operation: "shutdown",
        confirmation: "confirm_shutdown_preparation",
      }),
    );
    expect(statuses.at(-1)).toMatch(/^Invalid response:/u);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders and executes only the occurrence accepted from preparation", async () => {
    const occurrence = {
      operation: "shutdown",
      scheduledFor: "2026-08-09T13:00:00.000Z",
      wakeScheduledFor: "2026-08-09T14:00:00.000Z",
    } as const;
    const mutate = vi
      .fn()
      .mockResolvedValueOnce({ occurrence })
      .mockResolvedValueOnce({ result: "executed" });
    const { controller, refresh } = createController({
      read: vi.fn(async () => ({})),
      mutate,
    });
    const first = new FakeElement("section");
    await controller.render(
      first as unknown as HTMLElement,
      { shutdownEnabled: true },
      safety,
    );
    const prepareConfirmation = first.findAttribute(
      "aria-label",
      "Confirm mock shutdown preparation",
    );
    if (prepareConfirmation !== undefined) prepareConfirmation.checked = true;
    first.children
      .find((child) => child.tagName === "form")
      ?.dispatch("submit");
    await controller.settle();

    const second = new FakeElement("section");
    await controller.render(
      second as unknown as HTMLElement,
      { shutdownEnabled: true },
      safety,
    );
    expect(second.textContent).toContain(
      "Prepared mock shutdown: 2026-08-09T13:00:00.000Z",
    );
    const executionConfirmation = second.findAttribute(
      "aria-label",
      "Confirm prepared mock shutdown execution",
    );
    if (executionConfirmation !== undefined)
      executionConfirmation.checked = true;
    second.findText("Execute prepared mock shutdown")?.dispatch("click");
    await controller.settle();

    expect(mutate).toHaveBeenLastCalledWith(
      "/admin/power/shutdown/executions",
      "POST",
      { ...occurrence, confirmation: "confirm_shutdown_execution" },
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
