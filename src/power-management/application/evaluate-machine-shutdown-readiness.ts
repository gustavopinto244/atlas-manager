import type { PowerManagementClock } from "./ports/power-management-clock.js";
import type {
  MachineShutdownActiveTaskReadinessReader,
  MachineShutdownBackupReadinessReader,
  MachineShutdownConfirmationReader,
  MachineShutdownEventRecordingReadinessReader,
  MachineShutdownFilesystemReadinessReader,
  MachineShutdownServiceReadinessReader,
  MachineReadinessState,
} from "./ports/machine-shutdown-readiness-readers.js";
import { createMachineShutdownOccurrence } from "../domain/machine-shutdown-occurrence.js";
import {
  createMachineShutdownReadinessBlocker,
  type MachineShutdownReadinessBlocker,
} from "../domain/machine-shutdown-readiness-blocker.js";
import {
  createMachineShutdownReadinessDecision,
  type MachineShutdownReadinessDecision,
} from "../domain/machine-shutdown-readiness-decision.js";

export class EvaluateMachineShutdownReadiness {
  readonly #clock: PowerManagementClock;
  readonly #confirmation: MachineShutdownConfirmationReader;
  readonly #services: MachineShutdownServiceReadinessReader;
  readonly #tasks: MachineShutdownActiveTaskReadinessReader;
  readonly #backups: MachineShutdownBackupReadinessReader;
  readonly #filesystem: MachineShutdownFilesystemReadinessReader;
  readonly #events: MachineShutdownEventRecordingReadinessReader;
  public constructor(
    clock: PowerManagementClock,
    readers: {
      confirmation: MachineShutdownConfirmationReader;
      services: MachineShutdownServiceReadinessReader;
      activeTasks: MachineShutdownActiveTaskReadinessReader;
      backups: MachineShutdownBackupReadinessReader;
      filesystem: MachineShutdownFilesystemReadinessReader;
      eventRecording: MachineShutdownEventRecordingReadinessReader;
    },
  ) {
    this.#clock = clock;
    this.#confirmation = readers.confirmation;
    this.#services = readers.services;
    this.#tasks = readers.activeTasks;
    this.#backups = readers.backups;
    this.#filesystem = readers.filesystem;
    this.#events = readers.eventRecording;
    Object.freeze(this);
  }
  public async execute(
    input: unknown,
  ): Promise<MachineShutdownReadinessDecision> {
    const occurrence = createMachineShutdownOccurrence(input);
    return this.evaluateAt(occurrence, this.#clock.now().toISOString());
  }
  public async evaluateAt(
    input: unknown,
    evaluatedAt: string,
  ): Promise<MachineShutdownReadinessDecision> {
    const occurrence = createMachineShutdownOccurrence(input);
    const instant = Date.parse(evaluatedAt);
    if (instant < Date.parse(occurrence.scheduledFor))
      return createMachineShutdownReadinessDecision({
        occurrence,
        evaluatedAt,
        outcome: "rejected",
        blockers: [{ area: "confirmation", code: "not_due" }],
      });
    if (instant >= Date.parse(occurrence.wakeScheduledFor))
      return createMachineShutdownReadinessDecision({
        occurrence,
        evaluatedAt,
        outcome: "rejected",
        blockers: [{ area: "confirmation", code: "stale" }],
      });
    let confirmation: "confirmed" | "not_confirmed";
    try {
      confirmation = await this.#confirmation.read(occurrence, evaluatedAt);
    } catch {
      return createMachineShutdownReadinessDecision({
        occurrence,
        evaluatedAt,
        outcome: "rejected",
        blockers: [{ area: "confirmation", code: "confirmation_unavailable" }],
      });
    }
    if (confirmation !== "confirmed")
      return createMachineShutdownReadinessDecision({
        occurrence,
        evaluatedAt,
        outcome: "rejected",
        blockers: [{ area: "confirmation", code: "not_confirmed" }],
      });
    const blockers: MachineShutdownReadinessBlocker[] = [];
    await this.#collectService(blockers, occurrence, evaluatedAt);
    await this.#collect(
      blockers,
      this.#tasks,
      "active_tasks",
      occurrence,
      evaluatedAt,
    );
    await this.#collect(
      blockers,
      this.#backups,
      "backups",
      occurrence,
      evaluatedAt,
    );
    await this.#collect(
      blockers,
      this.#filesystem,
      "filesystem",
      occurrence,
      evaluatedAt,
    );
    await this.#collect(
      blockers,
      this.#events,
      "event_recording",
      occurrence,
      evaluatedAt,
    );
    return createMachineShutdownReadinessDecision({
      occurrence,
      evaluatedAt,
      outcome: blockers.length === 0 ? "approved" : "rejected",
      blockers,
    });
  }
  async #collectService(
    blockers: MachineShutdownReadinessBlocker[],
    occurrence: ReturnType<typeof createMachineShutdownOccurrence>,
    evaluatedAt: string,
  ): Promise<void> {
    try {
      const result = await this.#services.read(occurrence, evaluatedAt);
      blockers.push(
        ...result.blockers.map(createMachineShutdownReadinessBlocker),
      );
    } catch {
      blockers.push(
        createMachineShutdownReadinessBlocker({
          area: "services",
          code: "service_readiness_unavailable",
        }),
      );
    }
  }
  async #collect(
    blockers: MachineShutdownReadinessBlocker[],
    reader: {
      read(
        occurrence: ReturnType<typeof createMachineShutdownOccurrence>,
        evaluatedAt: string,
      ): Promise<MachineReadinessState>;
    },
    area: "active_tasks" | "backups" | "filesystem" | "event_recording",
    occurrence: ReturnType<typeof createMachineShutdownOccurrence>,
    evaluatedAt: string,
  ): Promise<void> {
    try {
      const result = await reader.read(occurrence, evaluatedAt);
      if (result.state === "blocked") {
        if (result.area === "active_tasks")
          blockers.push(
            createMachineShutdownReadinessBlocker({
              area: result.area,
              code: "active_tasks_present",
              activeTaskCount: result.activeTaskCount,
            }),
          );
        else
          blockers.push(
            createMachineShutdownReadinessBlocker({
              area: result.area,
              code: result.reason,
            }),
          );
      }
    } catch {
      blockers.push(
        createMachineShutdownReadinessBlocker({
          area,
          code: "readiness_dependency_failed",
        }),
      );
    }
  }
}
