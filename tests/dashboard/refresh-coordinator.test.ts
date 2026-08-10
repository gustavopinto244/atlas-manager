import { describe, expect, it } from "vitest";

import {
  DashboardRefreshCoordinator,
  type DashboardSection,
  type SectionLoadResult,
} from "../../src/dashboard/refresh-coordinator.js";
import type {
  SectionState,
  SectionStatusRegion,
} from "../../src/dashboard/section-state.js";

class RecordingStatus {
  public readonly states: SectionState[] = [];

  public set(state: SectionState): void {
    this.states.push(state);
  }

  public get last(): SectionState | undefined {
    return this.states[this.states.length - 1];
  }

  public get kinds(): readonly string[] {
    return this.states.map((state) => state.kind);
  }
}

function section(
  capability: string,
  load: () => Promise<SectionLoadResult>,
): Readonly<{ section: DashboardSection; status: RecordingStatus }> {
  const status = new RecordingStatus();
  return {
    section: {
      capability,
      status: status as unknown as SectionStatusRegion,
      load,
    },
    status,
  };
}

const ready = (render: () => void = () => {}): SectionLoadResult =>
  ({ kind: "ready", render }) as const;

describe("DashboardRefreshCoordinator", () => {
  it("renders healthy sections when another section fails", async () => {
    const rendered: string[] = [];
    const overview = section("Overview", () =>
      Promise.resolve({ kind: "failed", outcome: "unavailable" } as const),
    );
    const services = section("Services", () =>
      Promise.resolve(ready(() => rendered.push("services"))),
    );
    const backups = section("Backups", () =>
      Promise.resolve(ready(() => rendered.push("backups"))),
    );

    await new DashboardRefreshCoordinator([
      overview.section,
      services.section,
      backups.section,
    ]).refresh();

    expect(overview.status.last).toEqual({
      kind: "failed",
      outcome: "unavailable",
    });
    expect(services.status.last).toEqual({ kind: "ready" });
    expect(backups.status.last).toEqual({ kind: "ready" });
    expect(rendered).toEqual(["services", "backups"]);
  });

  it("never leaves a failing section on the loading placeholder", async () => {
    const events = section("Events", () =>
      Promise.resolve({ kind: "failed", outcome: "forbidden" } as const),
    );
    await new DashboardRefreshCoordinator([events.section]).refresh();
    expect(events.status.kinds).toEqual(["loading", "failed"]);
    expect(events.status.last).toEqual({
      kind: "failed",
      outcome: "forbidden",
    });
  });

  it("keeps a rejecting loader from taking down the whole refresh", async () => {
    const rendered: string[] = [];
    const broken = section("Overview", () =>
      Promise.reject(new Error("loader crashed")),
    );
    const healthy = section("Services", () =>
      Promise.resolve(ready(() => rendered.push("services"))),
    );

    await new DashboardRefreshCoordinator([
      broken.section,
      healthy.section,
    ]).refresh();

    expect(broken.status.last).toEqual({
      kind: "failed",
      outcome: "network_error",
    });
    expect(rendered).toEqual(["services"]);
  });

  it("reports a later failure as stale once content has rendered", async () => {
    let result: SectionLoadResult = ready();
    const services = section("Services", () => Promise.resolve(result));
    const coordinator = new DashboardRefreshCoordinator([services.section]);

    await coordinator.refresh();
    expect(services.status.last).toEqual({ kind: "ready" });

    result = { kind: "failed", outcome: "busy" } as const;
    await coordinator.refresh();
    expect(services.status.last).toEqual({ kind: "stale", outcome: "busy" });
  });

  it("distinguishes an empty collection from a failed read", async () => {
    const services = section("Services", () =>
      Promise.resolve({
        kind: "empty",
        message: "No registered services.",
        render: () => {},
      } as const),
    );
    await new DashboardRefreshCoordinator([services.section]).refresh();
    expect(services.status.last).toEqual({
      kind: "empty",
      message: "No registered services.",
    });
  });

  it("discards an older overlapping load instead of overwriting the newest", async () => {
    const rendered: string[] = [];
    const resolvers: ((value: SectionLoadResult) => void)[] = [];
    const services = section(
      "Services",
      () =>
        new Promise<SectionLoadResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const coordinator = new DashboardRefreshCoordinator([services.section]);

    const first = coordinator.refresh();
    const second = coordinator.refresh();
    // Settle the newest load first, then the stale one.
    resolvers[1]?.(ready(() => rendered.push("second")));
    resolvers[0]?.(ready(() => rendered.push("first")));
    await Promise.all([first, second]);

    expect(rendered).toEqual(["second"]);
  });

  it("retries a single capability without disturbing the others", async () => {
    let overviewAttempts = 0;
    let servicesAttempts = 0;
    const overview = section("Overview", () => {
      overviewAttempts += 1;
      return Promise.resolve(ready());
    });
    const services = section("Services", () => {
      servicesAttempts += 1;
      return Promise.resolve(ready());
    });
    const coordinator = new DashboardRefreshCoordinator([
      overview.section,
      services.section,
    ]);

    await coordinator.refresh();
    await coordinator.refreshCapability("Services");

    expect(overviewAttempts).toBe(1);
    expect(servicesAttempts).toBe(2);
  });

  it("ignores a retry for an unknown capability", async () => {
    const coordinator = new DashboardRefreshCoordinator([]);
    await expect(
      coordinator.refreshCapability("Nonexistent"),
    ).resolves.toBeUndefined();
  });
});
