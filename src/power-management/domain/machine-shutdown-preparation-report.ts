/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "./machine-shutdown-occurrence.js";
import {
  createMachineShutdownReadinessDecision,
  type MachineShutdownReadinessDecision,
} from "./machine-shutdown-readiness-decision.js";
import {
  createMachineShutdownPreparationPlan,
  type MachineShutdownPreparationPlan,
} from "./machine-shutdown-preparation-plan.js";
import {
  createMachineShutdownPreparationEvent,
  type MachineShutdownPreparationEvent,
} from "./machine-shutdown-preparation-event.js";
import {
  createMachineShutdownPreparationStepResult,
  type MachineShutdownPreparationStepResult,
} from "./machine-shutdown-preparation-step-result.js";
import { isCanonicalTimestamp } from "./canonical-timestamp.js";
export type MachineShutdownPreparationOutcome =
  "not_required" | "blocked" | "prepared" | "incomplete";
export interface MachineShutdownPreparationReport {
  readonly occurrence: MachineShutdownOccurrence;
  readonly processedAt: string;
  readonly initialDecision: MachineShutdownReadinessDecision;
  readonly plan: MachineShutdownPreparationPlan | null;
  readonly steps: readonly MachineShutdownPreparationStepResult[];
  readonly events: readonly MachineShutdownPreparationEvent[];
  readonly finalDecision?: MachineShutdownReadinessDecision;
  readonly outcome: MachineShutdownPreparationOutcome;
}
export function createMachineShutdownPreparationReport(
  input: unknown,
): MachineShutdownPreparationReport {
  if (
    !isRecord(input) ||
    !isCanonicalTimestamp(input.processedAt) ||
    !Array.isArray(input.steps) ||
    !Array.isArray(input.events) ||
    !["not_required", "blocked", "prepared", "incomplete"].includes(
      String(input.outcome),
    )
  )
    throw new Error("Invalid machine shutdown preparation report");
  if (
    Reflect.ownKeys(input).some(
      (key) =>
        typeof key !== "string" ||
        ![
          "occurrence",
          "processedAt",
          "initialDecision",
          "plan",
          "steps",
          "events",
          "finalDecision",
          "outcome",
        ].includes(key),
    )
  )
    throw new Error("Invalid machine shutdown preparation report");
  let occurrence;
  let initial;
  try {
    occurrence = createMachineShutdownOccurrence(input.occurrence);
    initial = createMachineShutdownReadinessDecision(input.initialDecision);
  } catch {
    throw new Error("Invalid machine shutdown preparation report");
  }
  const plan =
    input.plan === null
      ? null
      : createMachineShutdownPreparationPlan(input.plan);
  const steps = Object.freeze(
    input.steps.map(createMachineShutdownPreparationStepResult),
  );
  const events = Object.freeze(
    input.events.map(createMachineShutdownPreparationEvent),
  );
  const finalDecision =
    input.finalDecision === undefined
      ? undefined
      : createMachineShutdownReadinessDecision(input.finalDecision);
  if (
    occurrence.scheduledFor !== initial.occurrence.scheduledFor ||
    occurrence.wakeScheduledFor !== initial.occurrence.wakeScheduledFor ||
    initial.evaluatedAt !== input.processedAt ||
    (plan !== null &&
      (plan.plannedAt !== input.processedAt ||
        plan.occurrence.scheduledFor !== occurrence.scheduledFor ||
        plan.occurrence.wakeScheduledFor !== occurrence.wakeScheduledFor ||
        JSON.stringify(plan.initialDecision) !== JSON.stringify(initial))) ||
    (finalDecision !== undefined &&
      (finalDecision.evaluatedAt !== input.processedAt ||
        finalDecision.occurrence.scheduledFor !== occurrence.scheduledFor ||
        finalDecision.occurrence.wakeScheduledFor !==
          occurrence.wakeScheduledFor))
  )
    throw new Error("Invalid machine shutdown preparation report");
  validateEvents(events, occurrence, input.processedAt);
  validateSteps(steps, plan);
  if (input.outcome === "not_required") {
    if (
      initial.outcome !== "approved" ||
      !plan ||
      plan.steps.length !== 0 ||
      steps.length > 0 ||
      events.length > 0 ||
      finalDecision !== undefined
    )
      throw new Error("Invalid machine shutdown preparation report");
  } else if (input.outcome === "blocked") {
    if (
      initial.outcome !== "rejected" ||
      plan !== null ||
      steps.length > 0 ||
      events.length > 0 ||
      finalDecision !== undefined
    )
      throw new Error("Invalid machine shutdown preparation report");
  } else if (input.outcome === "prepared") {
    if (
      initial.outcome !== "rejected" ||
      !plan ||
      !finalDecision ||
      finalDecision.outcome !== "approved" ||
      events.at(-1)?.kind !== "final_readiness_approved" ||
      steps.at(-1)?.kind !== "record_final_readiness"
    )
      throw new Error("Invalid machine shutdown preparation report");
  } else if (
    initial.outcome !== "rejected" ||
    !plan ||
    (finalDecision?.outcome === "approved" &&
      events.at(-1)?.kind === "final_readiness_approved") ||
    (finalDecision?.outcome === "rejected" &&
      events.length > 0 &&
      events.at(-1)?.kind !== "final_readiness_rejected" &&
      events.some((event) => event.kind === "final_readiness_rejected"))
  )
    throw new Error("Invalid machine shutdown preparation report");
  return Object.freeze({
    occurrence,
    processedAt: input.processedAt,
    initialDecision: initial,
    plan,
    steps,
    events,
    ...(finalDecision ? { finalDecision } : {}),
    outcome: input.outcome,
  } as MachineShutdownPreparationReport);
}

function validateEvents(
  events: readonly MachineShutdownPreparationEvent[],
  occurrence: MachineShutdownOccurrence,
  processedAt: string,
): void {
  events.forEach((event, index) => {
    if (
      event.sequence !== index + 1 ||
      event.occurredAt !== processedAt ||
      event.occurrence.scheduledFor !== occurrence.scheduledFor ||
      event.occurrence.wakeScheduledFor !== occurrence.wakeScheduledFor
    )
      throw new Error("Invalid machine shutdown preparation events");
  });
  if (events.length > 0 && events[0]?.kind !== "preparation_started")
    throw new Error("Invalid machine shutdown preparation events");
  const finalEvents = events.filter(
    (event) =>
      event.kind === "final_readiness_approved" ||
      event.kind === "final_readiness_rejected",
  );
  if (finalEvents.length > 1)
    throw new Error("Invalid machine shutdown preparation events");
}

function validateSteps(
  steps: readonly MachineShutdownPreparationStepResult[],
  plan: MachineShutdownPreparationPlan | null,
): void {
  if (!plan && steps.length > 0)
    throw new Error("Invalid machine shutdown preparation steps");
  if (!plan) return;
  const expected = plan.steps.filter(
    (step) => step !== "record_preparation_started",
  );
  if (
    steps.length > expected.length ||
    steps.some((step, index) => step.kind !== expected[index])
  )
    throw new Error("Invalid machine shutdown preparation steps");
}
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
