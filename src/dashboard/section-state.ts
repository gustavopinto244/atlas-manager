// Per-section async state.
//
// Each dashboard section owns its own live region so a failure names the
// capability that failed instead of overwriting one global status line shared
// with the separately served backup and event-history scripts. A section that
// already rendered content keeps it and reports "stale" rather than blanking,
// because stale authoritative data is more useful to an operator than an empty
// panel.

import {
  describeAdministrativeFailure,
  type AdministrativeFailureOutcome,
} from "./api-client.js";

export type SectionState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "empty"; message: string }>
  | Readonly<{ kind: "failed"; outcome: AdministrativeFailureOutcome }>
  | Readonly<{ kind: "stale"; outcome: AdministrativeFailureOutcome }>;

export interface SectionStatusRegionDependencies {
  readonly document: Document;
  readonly container: HTMLElement;
  readonly capability: string;
  readonly onRetry: () => void;
}

export class SectionStatusRegion {
  readonly #document: Document;
  readonly #region: HTMLElement;
  readonly #capability: string;
  readonly #onRetry: () => void;
  #state: SectionState = Object.freeze({ kind: "loading" as const });

  public constructor(dependencies: SectionStatusRegionDependencies) {
    this.#document = dependencies.document;
    this.#capability = dependencies.capability;
    this.#onRetry = dependencies.onRetry;
    const region = this.#document.createElement("p");
    region.className = "section-status";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    dependencies.container.append(region);
    this.#region = region;
    this.render();
  }

  public get state(): SectionState {
    return this.#state;
  }

  public set(state: SectionState): void {
    this.#state = state;
    this.render();
  }

  private render(): void {
    this.#region.replaceChildren();
    const state = this.#state;
    // The state kind is carried on the element as a modifier class so the
    // stylesheet can tell the four non-ready states apart. Without it every
    // state renders as identical grey prose, and "still loading", "nothing
    // here" and "this failed" are three very different things to an operator
    // scanning a page.
    this.#region.className = `section-status section-status--${state.kind}`;
    if (state.kind === "ready") {
      this.#region.hidden = true;
      return;
    }
    this.#region.hidden = false;
    if (state.kind === "loading") {
      this.#region.append(this.#document.createTextNode("Loading…"));
      return;
    }
    if (state.kind === "empty") {
      this.#region.append(this.#document.createTextNode(state.message));
      return;
    }
    const prefix =
      state.kind === "stale"
        ? `${this.#capability} could not be refreshed; showing the last known state.`
        : `${this.#capability} could not be read.`;
    this.#region.append(
      this.#document.createTextNode(
        `${prefix} ${describeAdministrativeFailure(state.outcome)} `,
      ),
    );
    const retry = this.#document.createElement("button");
    retry.type = "button";
    retry.className = "section-retry";
    retry.append(this.#document.createTextNode("Retry"));
    retry.addEventListener("click", () => {
      this.#onRetry();
    });
    this.#region.append(retry);
  }
}
