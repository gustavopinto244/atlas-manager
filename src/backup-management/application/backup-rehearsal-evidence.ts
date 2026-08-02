import { createHash } from "node:crypto";

export interface BackupRehearsalStep {
  readonly sequence: number;
  readonly action: string;
  readonly expectedResult: string;
  readonly observedResult: string;
  readonly reportSha256: string;
  readonly mutationClassification: string;
}

export interface BackupRehearsalEvidenceInput {
  readonly baselineCommit: string;
  readonly bundleSha256: string;
  readonly targetScenarios: readonly string[];
  readonly manualRunScenarios: readonly string[];
  readonly schedulerScenarios: readonly string[];
  readonly retentionScenarios: readonly string[];
  readonly authorizationScenarios: readonly string[];
  readonly shutdownReadinessScenarios: readonly string[];
  readonly steps: readonly BackupRehearsalStep[];
  readonly finalState: string;
}

export interface BackupRehearsalEvidence {
  readonly json: string;
  readonly sha256: string;
}

export function createBackupRehearsalEvidence(
  input: BackupRehearsalEvidenceInput,
): BackupRehearsalEvidence {
  if (
    !/^[0-9a-f]{40}$/u.test(input.baselineCommit) ||
    !/^[0-9a-f]{64}$/u.test(input.bundleSha256) ||
    input.steps.length > 64 ||
    [
      input.targetScenarios,
      input.manualRunScenarios,
      input.schedulerScenarios,
      input.retentionScenarios,
      input.authorizationScenarios,
      input.shutdownReadinessScenarios,
    ].some((items) => items.length > 32)
  )
    throw new Error("backup_rehearsal_evidence_invalid");
  const steps = input.steps.map((step, index) => {
    if (
      step.sequence !== index + 1 ||
      !/^[0-9a-f]{64}$/u.test(step.reportSha256) ||
      !isBoundedText(step.action) ||
      !isBoundedText(step.expectedResult) ||
      !isBoundedText(step.observedResult) ||
      !isBoundedText(step.mutationClassification)
    )
      throw new Error("backup_rehearsal_evidence_invalid");
    return Object.freeze({ ...step });
  });
  const evidence = {
    schemaVersion: 1,
    result: "passed",
    baselineCommit: input.baselineCommit,
    bundleSha256: input.bundleSha256,
    targetScenarios: [...input.targetScenarios],
    manualRunScenarios: [...input.manualRunScenarios],
    schedulerScenarios: [...input.schedulerScenarios],
    retentionScenarios: [...input.retentionScenarios],
    authorizationScenarios: [...input.authorizationScenarios],
    shutdownReadinessScenarios: [...input.shutdownReadinessScenarios],
    steps,
    evidenceChain: createEvidenceChain(steps),
    finalState: input.finalState,
  };
  const json = `${JSON.stringify(evidence)}\n`;
  if (Buffer.byteLength(json, "utf8") > 256 * 1024)
    throw new Error("backup_rehearsal_evidence_oversized");
  return Object.freeze({
    json,
    sha256: createHash("sha256").update(json).digest("hex"),
  });
}

function createEvidenceChain(steps: readonly BackupRehearsalStep[]): string {
  let previous = "0".repeat(64);
  for (const step of steps) {
    previous = createHash("sha256")
      .update(`${previous}${step.reportSha256}`, "utf8")
      .digest("hex");
  }
  return previous;
}

function isBoundedText(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
}
