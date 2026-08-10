// Refresh coordinator.
//
// Replaces the single rejecting Promise.all that previously drove the whole
// dashboard: one failing read cancelled every render call, so a healthy section
// stayed on its loading placeholder because an unrelated capability was down.
//
// Sections load independently and settle independently. A load is applied only
// if it is still the newest one for its own section, so an overlapping refresh
// cannot have an older result overwrite a newer one, and a retry on one section
// never invalidates another section's in-flight load.

import type { AdministrativeFailureOutcome } from "./api-client.js";
import type { SectionState, SectionStatusRegion } from "./section-state.js";

export type SectionLoadResult =
  | Readonly<{ kind: "ready"; render: () => void }>
  | Readonly<{ kind: "empty"; message: string; render: () => void }>
  | Readonly<{ kind: "failed"; outcome: AdministrativeFailureOutcome }>;

export interface DashboardSection {
  readonly capability: string;
  readonly status: SectionStatusRegion;
  readonly load: () => Promise<SectionLoadResult>;
}

export class DashboardRefreshCoordinator {
  readonly #sections: readonly DashboardSection[];
  readonly #generations = new Map<string, number>();
  readonly #rendered = new Set<string>();

  public constructor(sections: readonly DashboardSection[]) {
    this.#sections = Object.freeze([...sections]);
  }

  public async refresh(): Promise<void> {
    await Promise.allSettled(
      this.#sections.map((section) => this.#run(section)),
    );
  }

  public async refreshCapability(capability: string): Promise<void> {
    const section = this.#sections.find(
      (candidate) => candidate.capability === capability,
    );
    if (section === undefined) return;
    await this.#run(section);
  }

  async #run(section: DashboardSection): Promise<void> {
    const generation = (this.#generations.get(section.capability) ?? 0) + 1;
    this.#generations.set(section.capability, generation);
    section.status.set(Object.freeze({ kind: "loading" as const }));
    let result: SectionLoadResult;
    try {
      result = await section.load();
    } catch {
      // A section loader is not expected to reject; treat it as a failed read
      // rather than letting one section take down the coordinator.
      result = Object.freeze({
        kind: "failed" as const,
        outcome: "network_error" as const,
      });
    }
    if (this.#generations.get(section.capability) !== generation) return;
    section.status.set(this.#apply(section.capability, result));
  }

  #apply(capability: string, result: SectionLoadResult): SectionState {
    if (result.kind === "failed") {
      const outcome = result.outcome;
      return this.#rendered.has(capability)
        ? Object.freeze({ kind: "stale" as const, outcome })
        : Object.freeze({ kind: "failed" as const, outcome });
    }
    result.render();
    this.#rendered.add(capability);
    return result.kind === "empty"
      ? Object.freeze({ kind: "empty" as const, message: result.message })
      : Object.freeze({ kind: "ready" as const });
  }
}
