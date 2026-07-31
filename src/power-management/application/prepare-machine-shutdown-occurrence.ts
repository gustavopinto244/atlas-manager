/* eslint-disable @typescript-eslint/no-base-to-string, no-useless-assignment */
import type { PowerManagementClock } from "./ports/power-management-clock.js";
import type { EvaluateMachineShutdownReadiness } from "./evaluate-machine-shutdown-readiness.js";
import type { MachineShutdownReadinessDecision } from "../domain/machine-shutdown-readiness-decision.js";
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "../domain/machine-shutdown-occurrence.js";
import {
  createMachineShutdownPreparationPlan as createPlanModel,
  type MachineShutdownPreparationPlan,
  type MachineShutdownPreparationStep,
} from "../domain/machine-shutdown-preparation-plan.js";
import {
  createMachineShutdownPreparationEvent,
  type MachineShutdownPreparationEvent,
} from "../domain/machine-shutdown-preparation-event.js";
import {
  createMachineShutdownPreparationStepResult,
  type MachineShutdownPreparationStepResult,
} from "../domain/machine-shutdown-preparation-step-result.js";
import {
  createMachineShutdownPreparationReport,
  type MachineShutdownPreparationReport,
} from "../domain/machine-shutdown-preparation-report.js";
import type {
  MachineShutdownActiveTaskDrainController,
  MachineShutdownBackupCompletionController,
  MachineShutdownFilesystemSynchronizationController,
  MachineShutdownPreparationEventRecorder,
  MachineShutdownServicePreparationController,
} from "./ports/machine-shutdown-preparation-controllers.js";
import type { AdministrativeAuditTrail } from "../../event-history/application/administrative-audit-trail.js";
import {
  AdministrativeAuditPartialEffectError,
  type AdministrativeAuditTrailError,
} from "../../event-history/application/administrative-audit-trail.js";
import {
  DIRECT_POWER_AUDIT_SOURCE,
  MACHINE_AUDIT_TARGET,
} from "./administrative-audit-context.js";
import type { AdministrativeEventSource } from "../../event-history/domain/administrative-event.js";

const PREPARABLE = new Set([
  "service_running",
  "active_tasks_present",
  "backup_in_progress",
  "filesystem_sync_required",
]);

export type MachineShutdownPreparationPlanningResult =
  | Readonly<{
      outcome: "planned";
      plan: MachineShutdownPreparationPlan;
    }>
  | Readonly<{
      outcome: "blocked";
      decision: MachineShutdownReadinessDecision;
    }>;

export function createMachineShutdownPreparationPlan(input: {
  occurrence: MachineShutdownOccurrence;
  processedAt: string;
  initialDecision: MachineShutdownReadinessDecision;
}): MachineShutdownPreparationPlanningResult {
  if (input.initialDecision.outcome === "approved")
    return Object.freeze({
      outcome: "planned" as const,
      plan: createPlanModel({
        occurrence: input.occurrence,
        plannedAt: input.processedAt,
        initialDecision: input.initialDecision,
        steps: [],
      }),
    });
  if (
    input.initialDecision.blockers.some(
      (blocker) =>
        !PREPARABLE.has(blocker.code) ||
        (blocker.code === "service_running" && !blocker.serviceId),
    )
  )
    return Object.freeze({
      outcome: "blocked" as const,
      decision: input.initialDecision,
    });
  const codes = new Set(
    input.initialDecision.blockers.map((blocker) => blocker.code),
  );
  const steps: MachineShutdownPreparationStep[] = [
    "record_preparation_started",
  ];
  if (codes.has("service_running")) steps.push("stop_registered_services");
  if (codes.has("active_tasks_present")) steps.push("drain_active_tasks");
  if (codes.has("backup_in_progress")) steps.push("complete_backup");
  if (codes.has("filesystem_sync_required"))
    steps.push("synchronize_filesystem");
  steps.push(
    "record_preparation_completed",
    "reevaluate_readiness",
    "record_final_readiness",
  );
  return Object.freeze({
    outcome: "planned" as const,
    plan: createPlanModel({
      occurrence: input.occurrence,
      plannedAt: input.processedAt,
      initialDecision: input.initialDecision,
      steps,
    }),
  });
}

export class PrepareMachineShutdownOccurrence {
  readonly #clock: PowerManagementClock;
  readonly #readiness: EvaluateMachineShutdownReadiness;
  readonly #services: MachineShutdownServicePreparationController | undefined;
  readonly #tasks: MachineShutdownActiveTaskDrainController;
  readonly #backup: MachineShutdownBackupCompletionController;
  readonly #filesystem: MachineShutdownFilesystemSynchronizationController;
  readonly #events: MachineShutdownPreparationEventRecorder;
  readonly #audit: AdministrativeAuditTrail | undefined;
  public constructor(
    clock: PowerManagementClock,
    readiness: EvaluateMachineShutdownReadiness,
    controllers: {
      tasks: MachineShutdownActiveTaskDrainController;
      backup: MachineShutdownBackupCompletionController;
      filesystem: MachineShutdownFilesystemSynchronizationController;
      events: MachineShutdownPreparationEventRecorder;
      services?: MachineShutdownServicePreparationController | undefined;
      audit?: AdministrativeAuditTrail;
    },
  ) {
    this.#clock = clock;
    this.#readiness = readiness;
    this.#services = controllers.services;
    this.#tasks = controllers.tasks;
    this.#backup = controllers.backup;
    this.#filesystem = controllers.filesystem;
    this.#events = controllers.events;
    this.#audit = controllers.audit;
    Object.freeze(this);
  }
  public async execute(
    input: unknown,
  ): Promise<MachineShutdownPreparationReport> {
    const processedAt = this.#clock.now().toISOString();
    return this.executeAsAuthorized(
      input,
      processedAt,
      DIRECT_POWER_AUDIT_SOURCE,
    );
  }

  public async executeAsAuthorized(
    input: unknown,
    processedAt: string,
    source: AdministrativeEventSource,
  ): Promise<MachineShutdownPreparationReport> {
    const occurrence = createMachineShutdownOccurrence(input);
    if (!this.#audit) return this.prepareAt(occurrence, processedAt);
    const attempt = await this.#audit.begin({
      occurredAt: processedAt,
      source,
      target: MACHINE_AUDIT_TARGET,
      operation: "prepare_machine_shutdown_occurrence",
      details: {
        scheduledFor: occurrence.scheduledFor,
        wakeScheduledFor: occurrence.wakeScheduledFor,
      },
    });
    let report: MachineShutdownPreparationReport;
    try {
      report = await this.prepareAt(occurrence, processedAt);
    } catch (error) {
      try {
        await this.#audit.complete(attempt, "failed", {
          failureCode: "preparation_dependency_failed",
        });
      } catch {
        // The primary preparation failure remains authoritative.
      }
      throw error;
    }
    const status =
      report.outcome === "not_required" || report.outcome === "prepared"
        ? ("succeeded" as const)
        : ("rejected" as const);
    const details = {
      preparationOutcome: report.outcome,
      blockerCodes: report.finalDecision?.blockers.map(
        (blocker) => blocker.code,
      ),
      completedStepCount: report.steps.filter(
        (step) => step.outcome === "completed",
      ).length,
    };
    try {
      await this.#audit.complete(attempt, status, details);
    } catch (error) {
      if (isAuditError(error) && hasPreparationEffect(report))
        throw new AdministrativeAuditPartialEffectError(
          "audit_failed_after_shutdown_preparation",
          report,
        );
      throw error;
    }
    return report;
  }
  public async prepareAt(
    input: unknown,
    processedAt: string,
    suppliedDecision?: MachineShutdownReadinessDecision,
  ): Promise<MachineShutdownPreparationReport> {
    const occurrence = createMachineShutdownOccurrence(input);
    const initialDecision =
      suppliedDecision ??
      (await this.#readiness.evaluateAt(occurrence, processedAt));
    const planning = createMachineShutdownPreparationPlan({
      occurrence,
      processedAt,
      initialDecision,
    });
    if (planning.outcome === "blocked")
      return createMachineShutdownPreparationReport({
        occurrence,
        processedAt,
        initialDecision,
        plan: null,
        steps: [],
        events: [],
        outcome: "blocked",
      });
    const plan = planning.plan;
    if (plan.steps.length === 0)
      return createMachineShutdownPreparationReport({
        occurrence,
        processedAt,
        initialDecision,
        plan,
        steps: [],
        events: [],
        outcome: "not_required",
      });
    const steps: MachineShutdownPreparationStepResult[] = [];
    const events: MachineShutdownPreparationEvent[] = [];
    let sequence = 0;
    const event = async (
      kind: MachineShutdownPreparationEvent["kind"],
      detail: Record<string, unknown> = {},
    ): Promise<boolean> => {
      const nextSequence = ++sequence;
      try {
        const value = createMachineShutdownPreparationEvent({
          sequence: nextSequence,
          kind,
          occurrence,
          occurredAt: processedAt,
          ...detail,
        });
        await this.#events.record(value);
        events.push(value);
        return true;
      } catch {
        sequence -= 1;
        return false;
      }
    };
    if (!(await event("preparation_started")))
      return this.report(
        occurrence,
        processedAt,
        initialDecision,
        plan,
        steps,
        events,
        "incomplete",
      );
    for (const kind of plan.steps) {
      if (
        [
          "record_preparation_started",
          "record_preparation_completed",
          "reevaluate_readiness",
          "record_final_readiness",
        ].includes(kind)
      )
        continue;
      const startedAt = processedAt;
      let outcome: "completed" | "skipped" | "blocked" | "failed" = "failed";
      let detail: Record<string, unknown> = {};
      try {
        if (kind === "stop_registered_services") {
          const serviceIds = [
            ...new Set(
              initialDecision.blockers
                .filter((b) => b.code === "service_running" && b.serviceId)
                .map((b) => b.serviceId!),
            ),
          ].sort();
          if (!this.#services) {
            outcome = "failed";
            detail = { failureCode: "service_stop_failed" };
          } else {
            const result = await this.#services.prepare({
              occurrence,
              requestedAt: processedAt,
              serviceIds,
            });
            if (
              result.steps.length > serviceIds.length ||
              result.steps.some(
                (step) => !serviceIds.includes(step.serviceId),
              ) ||
              new Set(result.steps.map((step) => step.serviceId)).size !==
                result.steps.length ||
              (result.successful && result.steps.length !== serviceIds.length)
            )
              throw new Error("service_preparation_result_invalid");
            const failed = result.steps.find(
              (step) => step.outcome === "failed",
            );
            outcome = failed ? "failed" : "completed";
            detail = failed
              ? { failureCode: failed.failureCode, serviceSteps: result.steps }
              : {
                  serviceSteps: result.steps,
                  stoppedCount: result.steps.filter(
                    (s) => s.outcome === "stopped",
                  ).length,
                  alreadyStoppedCount: result.steps.filter(
                    (s) => s.outcome === "already_stopped",
                  ).length,
                };
          }
        } else if (kind === "drain_active_tasks") {
          const result = await this.#tasks.drain(occurrence, processedAt);
          outcome =
            result.outcome === "blocked"
              ? "blocked"
              : result.outcome === "drained"
                ? "completed"
                : "skipped";
          detail =
            result.outcome === "blocked"
              ? {
                  failureCode: "active_tasks_present",
                  remainingTaskCount: result.remainingTaskCount,
                }
              : { outcome: result.outcome };
        } else if (kind === "complete_backup") {
          const result = await this.#backup.complete(occurrence, processedAt);
          outcome =
            result.outcome === "blocked"
              ? "blocked"
              : result.outcome === "completed"
                ? "completed"
                : "skipped";
          detail =
            result.outcome === "blocked"
              ? { failureCode: result.reason }
              : { outcome: result.outcome };
        } else {
          const result = await this.#filesystem.synchronize(
            occurrence,
            processedAt,
          );
          outcome =
            result.outcome === "blocked"
              ? "blocked"
              : result.outcome === "synchronized"
                ? "completed"
                : "skipped";
          detail =
            result.outcome === "blocked"
              ? { failureCode: result.reason }
              : { outcome: result.outcome };
        }
      } catch {
        outcome = "failed";
        detail = { failureCode: "preparation_dependency_failed" };
      }
      const step = createMachineShutdownPreparationStepResult({
        kind,
        startedAt,
        completedAt: processedAt,
        outcome,
        detail:
          kind === "stop_registered_services"
            ? {
                serviceSteps:
                  (detail.serviceSteps as readonly {
                    readonly serviceId: string;
                    readonly outcome: "stopped" | "already_stopped" | "failed";
                    readonly failureCode?:
                      | "service_status_failed"
                      | "service_stop_not_supported"
                      | "service_stop_failed"
                      | "service_plan_invalid";
                  }[]) ?? [],
                ...(outcome === "failed"
                  ? { failureCode: detail.failureCode }
                  : {}),
              }
            : detail,
      });
      steps.push(step);
      if (outcome === "blocked" || outcome === "failed") {
        await event("preparation_failed", {
          failedStep: kind,
          failureCode: String(
            detail.failureCode ?? "preparation_dependency_failed",
          ),
        });
        return this.report(
          occurrence,
          processedAt,
          initialDecision,
          plan,
          steps,
          events,
          "incomplete",
        );
      }
      const completedKind =
        kind === "stop_registered_services"
          ? "services_prepared"
          : kind === "drain_active_tasks"
            ? "active_tasks_prepared"
            : kind === "complete_backup"
              ? "backup_prepared"
              : "filesystem_prepared";
      const completedDetail =
        kind === "stop_registered_services"
          ? {
              stoppedCount: Number(detail.stoppedCount ?? 0),
              alreadyStoppedCount: Number(detail.alreadyStoppedCount ?? 0),
            }
          : detail;
      if (!(await event(completedKind, completedDetail))) {
        await event("preparation_failed", {
          failedStep: kind,
          failureCode: "event_recording_failed",
        });
        return this.report(
          occurrence,
          processedAt,
          initialDecision,
          plan,
          steps,
          events,
          "incomplete",
        );
      }
    }
    const completion = createMachineShutdownPreparationStepResult({
      kind: "record_preparation_completed",
      startedAt: processedAt,
      completedAt: processedAt,
      outcome: "completed",
    });
    steps.push(completion);
    if (!(await event("preparation_completed")))
      return this.report(
        occurrence,
        processedAt,
        initialDecision,
        plan,
        steps,
        events,
        "incomplete",
      );
    const finalDecision = await this.#readiness.evaluateAt(
      occurrence,
      processedAt,
    );
    const reevaluate = createMachineShutdownPreparationStepResult({
      kind: "reevaluate_readiness",
      startedAt: processedAt,
      completedAt: processedAt,
      outcome: "completed",
    });
    steps.push(reevaluate);
    const finalKind =
      finalDecision.outcome === "approved"
        ? "final_readiness_approved"
        : "final_readiness_rejected";
    if (
      !(await event(
        finalKind,
        finalDecision.outcome === "rejected"
          ? { blockerCodes: finalDecision.blockers.map((b) => b.code) }
          : {},
      ))
    ) {
      await event("preparation_failed", {
        failedStep: "record_final_readiness",
        failureCode: "event_recording_failed",
      });
      return this.report(
        occurrence,
        processedAt,
        initialDecision,
        plan,
        steps,
        events,
        "incomplete",
        finalDecision,
      );
    }
    steps.push(
      createMachineShutdownPreparationStepResult({
        kind: "record_final_readiness",
        startedAt: processedAt,
        completedAt: processedAt,
        outcome: "completed",
      }),
    );
    return createMachineShutdownPreparationReport({
      occurrence,
      processedAt,
      initialDecision,
      plan,
      steps,
      events,
      finalDecision,
      outcome: finalDecision.outcome === "approved" ? "prepared" : "incomplete",
    });
  }
  private report(
    occurrence: MachineShutdownOccurrence,
    processedAt: string,
    initialDecision: MachineShutdownReadinessDecision,
    plan: MachineShutdownPreparationPlan,
    steps: readonly MachineShutdownPreparationStepResult[],
    events: readonly MachineShutdownPreparationEvent[],
    outcome: "incomplete",
    finalDecision?: MachineShutdownReadinessDecision,
  ) {
    return createMachineShutdownPreparationReport({
      occurrence,
      processedAt,
      initialDecision,
      plan,
      steps,
      events,
      ...(finalDecision ? { finalDecision } : {}),
      outcome,
    });
  }
}

function hasPreparationEffect(
  report: MachineShutdownPreparationReport,
): boolean {
  return report.steps.some(
    (step) =>
      (step.kind === "stop_registered_services" ||
        step.kind === "drain_active_tasks" ||
        step.kind === "complete_backup" ||
        step.kind === "synchronize_filesystem") &&
      step.outcome === "completed",
  );
}

function isAuditError(error: unknown): error is AdministrativeAuditTrailError {
  return (
    error instanceof Error && error.name === "AdministrativeAuditTrailError"
  );
}
