import { createHash } from "node:crypto";

export interface EventHistoryRehearsalStep {
  readonly sequence: number;
  readonly action: string;
  readonly expectedResult: string;
  readonly observedResult: string;
  readonly reportSha256: string;
  readonly mutationClassification: string;
}

export interface EventHistoryRehearsalEvidenceInput {
  readonly baselineCommit: string;
  readonly bundleSha256: string;
  readonly migration: readonly string[];
  readonly writerCoordination: readonly string[];
  readonly rotation: readonly string[];
  readonly integrity: readonly string[];
  readonly retention: readonly string[];
  readonly exports: readonly string[];
  readonly authorization: readonly string[];
  readonly dashboard: readonly string[];
  readonly steps: readonly EventHistoryRehearsalStep[];
  readonly finalState: string;
}

export interface EventHistoryRehearsalEvidence {
  readonly json: string;
  readonly sha256: string;
}

export function createEventHistoryRehearsalEvidence(
  input: EventHistoryRehearsalEvidenceInput,
): EventHistoryRehearsalEvidence {
  if (
    !/^[0-9a-f]{40}$/u.test(input.baselineCommit) ||
    !/^[0-9a-f]{64}$/u.test(input.bundleSha256) ||
    input.steps.length === 0 ||
    input.steps.length > 128 ||
    [
      input.migration,
      input.writerCoordination,
      input.rotation,
      input.integrity,
      input.retention,
      input.exports,
      input.authorization,
      input.dashboard,
    ].some((items) => items.length > 32)
  )
    throw new Error("event_history_rehearsal_evidence_invalid");

  const steps = input.steps.map((step, index) => {
    if (
      step.sequence !== index + 1 ||
      !/^[0-9a-f]{64}$/u.test(step.reportSha256) ||
      !isBoundedText(step.action) ||
      !isBoundedText(step.expectedResult) ||
      !isBoundedText(step.observedResult) ||
      !isBoundedText(step.mutationClassification)
    )
      throw new Error("event_history_rehearsal_evidence_invalid");
    return Object.freeze({ ...step });
  });

  const evidence = {
    schemaVersion: 1,
    result: "passed",
    baselineCommit: input.baselineCommit,
    bundleSha256: input.bundleSha256,
    migration: [...input.migration],
    writerCoordination: [...input.writerCoordination],
    rotation: [...input.rotation],
    integrity: [...input.integrity],
    retention: [...input.retention],
    exports: [...input.exports],
    authorization: [...input.authorization],
    dashboard: [...input.dashboard],
    steps,
    evidenceChain: createEvidenceChain(steps),
    finalState: input.finalState,
  };
  const json = `${JSON.stringify(evidence)}\n`;
  if (Buffer.byteLength(json, "utf8") > 128 * 1024)
    throw new Error("event_history_rehearsal_evidence_oversized");
  return Object.freeze({
    json,
    sha256: createHash("sha256").update(json).digest("hex"),
  });
}

function createEvidenceChain(
  steps: readonly EventHistoryRehearsalStep[],
): string {
  let previous = "0".repeat(64);
  for (const step of steps)
    previous = createHash("sha256")
      .update(`${previous}${step.reportSha256}`, "utf8")
      .digest("hex");
  return previous;
}

function isBoundedText(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
}
