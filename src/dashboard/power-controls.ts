import {
  MACHINE_SHUTDOWN_EXECUTION_CONFIRMATION,
  MACHINE_SHUTDOWN_PREPARATION_CONFIRMATION,
} from "../power-management/domain/machine-shutdown-confirmation.js";

type PowerMutationMethod = "PUT" | "DELETE" | "POST";

export type PowerControlsFailureKind =
  "unauthorized" | "busy" | "invalid_response" | "failed";

export class PowerControlsRequestError extends Error {
  public override readonly name = "PowerControlsRequestError";

  public constructor(public readonly kind: PowerControlsFailureKind) {
    super(kind);
  }
}

export interface PowerControlsTransport {
  readonly read: (path: string) => Promise<unknown>;
  readonly mutate: (
    path: string,
    method: PowerMutationMethod,
    body: unknown,
  ) => Promise<unknown>;
}

export interface PowerControlsDependencies {
  readonly document: Document;
  readonly transport: PowerControlsTransport;
  readonly refresh: () => Promise<void>;
  readonly setStatus: (message: string) => void;
  readonly now?: () => Date;
}

interface ShutdownOccurrence {
  readonly operation: "shutdown";
  readonly scheduledFor: string;
  readonly wakeScheduledFor: string;
}

export class PowerControlsController {
  readonly #document: Document;
  readonly #transport: PowerControlsTransport;
  readonly #refresh: () => Promise<void>;
  readonly #setStatus: (message: string) => void;
  readonly #now: () => Date;
  #preparedShutdownOccurrence: ShutdownOccurrence | undefined;
  #pending: Promise<void> = Promise.resolve();

  public constructor(dependencies: PowerControlsDependencies) {
    this.#document = dependencies.document;
    this.#transport = dependencies.transport;
    this.#refresh = dependencies.refresh;
    this.#setStatus = dependencies.setStatus;
    this.#now = dependencies.now ?? (() => new Date());
  }

  public render(
    parent: HTMLElement,
    administration: Readonly<Record<string, unknown>>,
    powerSafety: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    parent.replaceChildren();
    const heading = this.#document.createElement("h3");
    heading.textContent = "Mock power controls";
    const note = this.#document.createElement("p");
    note.textContent = `Backend: ${displayValue(powerSafety.backend, "unavailable")} · effects: ${displayValue(powerSafety.effects, "unavailable")} · scheduler: ${displayValue(powerSafety.machineScheduler, "unavailable")}`;
    parent.append(heading, note);

    const wakeEnabled = administration.wakeAlarmEnabled === true;
    const shutdownEnabled = administration.shutdownEnabled === true;
    if (!wakeEnabled && !shutdownEnabled) {
      const disabled = this.#document.createElement("p");
      disabled.textContent =
        "Wake-alarm and shutdown HTTP controls are disabled by configuration.";
      parent.append(disabled);
      this.#pending = Promise.resolve();
      return this.#pending;
    }

    const pending: Promise<void>[] = [];
    if (wakeEnabled) pending.push(this.#renderWakeAlarmControls(parent));
    if (shutdownEnabled) {
      this.#renderShutdownPreparationControl(parent);
      if (this.#preparedShutdownOccurrence !== undefined)
        this.#renderShutdownExecutionControl(
          parent,
          this.#preparedShutdownOccurrence,
        );
    }
    this.#pending = Promise.all(pending).then(() => undefined);
    return this.#pending;
  }

  public settle(): Promise<void> {
    return this.#pending;
  }

  async #renderWakeAlarmControls(parent: HTMLElement): Promise<void> {
    const current = this.#document.createElement("p");
    current.setAttribute("role", "status");
    current.textContent = "Current wake alarm: loading…";
    parent.append(current);

    const load = this.#transport
      .read("/admin/power/wake-alarm")
      .then((value) => {
        current.textContent = formatWakeAlarm(value);
      })
      .catch((error: unknown) => {
        current.textContent = wakeAlarmFailureText(error);
      });

    const form = this.#document.createElement("form");
    const label = this.#document.createElement("label");
    label.textContent = "Mock wake time";
    const input = this.#document.createElement("input");
    input.type = "datetime-local";
    input.required = true;
    input.setAttribute("aria-label", "Mock wake time");
    input.value = new Date(this.#now().getTime() + 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    label.append(input);
    const schedule = this.#document.createElement("button");
    schedule.type = "submit";
    schedule.textContent = "Schedule mock wake";
    const cancel = this.#document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel mock wake";
    form.append(label, schedule, cancel);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#pending = this.#runMutation(
        "/admin/power/wake-alarm",
        "PUT",
        { scheduledFor: new Date(input.value).toISOString() },
        schedule,
      );
    });
    cancel.addEventListener("click", () => {
      this.#pending = this.#runMutation(
        "/admin/power/wake-alarm",
        "DELETE",
        undefined,
        cancel,
      );
    });
    parent.append(form);
    await load;
  }

  #renderShutdownPreparationControl(parent: HTMLElement): void {
    const form = this.#document.createElement("form");
    const label = this.#document.createElement("label");
    label.textContent = "Mock shutdown preparation";
    const confirmationLabel = this.#document.createElement("label");
    const confirmation = this.#document.createElement("input");
    confirmation.type = "checkbox";
    confirmation.required = true;
    confirmation.setAttribute(
      "aria-label",
      "Confirm mock shutdown preparation",
    );
    confirmationLabel.append(
      confirmation,
      this.#document.createTextNode(
        "I confirm this mock shutdown preparation.",
      ),
    );
    const button = this.#document.createElement("button");
    button.type = "submit";
    button.className = "destructive-action";
    button.textContent = "Prepare mock shutdown";
    const feedback = this.#document.createElement("p");
    feedback.setAttribute("role", "status");
    form.append(label, confirmationLabel, button, feedback);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!confirmation.checked) {
        feedback.textContent = "Explicit confirmation is required.";
        return;
      }
      feedback.textContent = "";
      const scheduledFor = new Date(this.#now().getTime() + 60 * 60 * 1000);
      const wakeScheduledFor = new Date(
        scheduledFor.getTime() + 60 * 60 * 1000,
      );
      this.#pending = this.#runMutation(
        "/admin/power/shutdown/preparations",
        "POST",
        {
          operation: "shutdown",
          scheduledFor: scheduledFor.toISOString(),
          wakeScheduledFor: wakeScheduledFor.toISOString(),
          confirmation: MACHINE_SHUTDOWN_PREPARATION_CONFIRMATION,
        },
        button,
        (value) => {
          const occurrence = readShutdownOccurrence(value);
          if (occurrence === undefined)
            throw new PowerControlsRequestError("invalid_response");
          this.#preparedShutdownOccurrence = occurrence;
        },
      );
    });
    parent.append(form);
  }

  #renderShutdownExecutionControl(
    parent: HTMLElement,
    occurrence: ShutdownOccurrence,
  ): void {
    const section = this.#document.createElement("div");
    const summary = this.#document.createElement("p");
    summary.textContent = `Prepared mock shutdown: ${occurrence.scheduledFor} → wake ${occurrence.wakeScheduledFor}`;
    const confirmationLabel = this.#document.createElement("label");
    const confirmation = this.#document.createElement("input");
    confirmation.type = "checkbox";
    confirmation.required = true;
    confirmation.setAttribute(
      "aria-label",
      "Confirm prepared mock shutdown execution",
    );
    confirmationLabel.append(
      confirmation,
      this.#document.createTextNode(
        "I confirm execution of this prepared mock action.",
      ),
    );
    const button = this.#document.createElement("button");
    button.type = "button";
    button.className = "destructive-action";
    button.textContent = "Execute prepared mock shutdown";
    const feedback = this.#document.createElement("p");
    feedback.setAttribute("role", "status");
    button.addEventListener("click", () => {
      if (!confirmation.checked) {
        feedback.textContent = "Explicit confirmation is required.";
        return;
      }
      feedback.textContent = "";
      this.#pending = this.#runMutation(
        "/admin/power/shutdown/executions",
        "POST",
        {
          ...occurrence,
          confirmation: MACHINE_SHUTDOWN_EXECUTION_CONFIRMATION,
        },
        button,
        () => {
          this.#preparedShutdownOccurrence = undefined;
        },
      );
    });
    section.append(summary, confirmationLabel, button, feedback);
    parent.append(section);
  }

  async #runMutation(
    path: string,
    method: PowerMutationMethod,
    body: unknown,
    button: HTMLButtonElement,
    onSuccess?: (value: unknown) => void,
  ): Promise<void> {
    button.disabled = true;
    try {
      const result = await this.#transport.mutate(path, method, body);
      onSuccess?.(result);
      this.#setStatus("Saved: authoritative mock power state updated.");
      await this.#refresh();
    } catch (error) {
      this.#setStatus(mutationFailureText(error));
    } finally {
      button.disabled = false;
    }
  }
}

function formatWakeAlarm(value: unknown): string {
  const alarm = readRecord(readRecord(value).wakeAlarm);
  if (alarm.state === "not_scheduled")
    return "Current wake alarm: not_scheduled";
  if (
    alarm.state === "scheduled" &&
    typeof alarm.scheduledFor === "string" &&
    Number.isFinite(Date.parse(alarm.scheduledFor))
  )
    return `Current wake alarm: scheduled at ${alarm.scheduledFor}`;
  throw new PowerControlsRequestError("invalid_response");
}

function wakeAlarmFailureText(error: unknown): string {
  const kind = failureKind(error);
  if (kind === "unauthorized") return "Current wake alarm: unauthorized";
  if (kind === "busy") return "Current wake alarm: busy";
  if (kind === "invalid_response")
    return "Current wake alarm: invalid response";
  return "Current wake alarm: unavailable";
}

function mutationFailureText(error: unknown): string {
  const kind = failureKind(error);
  if (kind === "unauthorized")
    return "Unauthorized: administrative power access denied.";
  if (kind === "busy")
    return "Busy: another administrative power operation is in progress.";
  if (kind === "invalid_response")
    return "Invalid response: authoritative power state was not accepted.";
  return "Failed: mock power state could not be updated.";
}

function failureKind(error: unknown): PowerControlsFailureKind {
  return error instanceof PowerControlsRequestError ? error.kind : "failed";
}

function readShutdownOccurrence(
  value: unknown,
): ShutdownOccurrence | undefined {
  const occurrence = readRecord(readRecord(value).occurrence);
  if (
    occurrence.operation !== "shutdown" ||
    typeof occurrence.scheduledFor !== "string" ||
    typeof occurrence.wakeScheduledFor !== "string" ||
    !Number.isFinite(Date.parse(occurrence.scheduledFor)) ||
    !Number.isFinite(Date.parse(occurrence.wakeScheduledFor))
  )
    return undefined;
  return {
    operation: "shutdown",
    scheduledFor: occurrence.scheduledFor,
    wakeScheduledFor: occurrence.wakeScheduledFor,
  };
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function displayValue(value: unknown, fallback: string): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : fallback;
}
