import { describe, expect, it } from "vitest";
import { createEventHistoryRehearsalEvidence } from "../../../src/event-history/application/event-history-rehearsal-evidence.js";

describe("event-history operational rehearsal evidence", () => {
  it("is bounded, deterministic, and excludes private state", () => {
    const input = {
      baselineCommit: "fa94db38ade054f72637c238b8f8c63bbea41702",
      bundleSha256: "a".repeat(64),
      migration: ["migrated", "unchanged"],
      writerCoordination: ["busy", "contiguous"],
      rotation: ["rotated"],
      integrity: ["verified", "verified_with_retention"],
      retention: ["anchor_preserved"],
      exports: ["deterministic", "download_verified"],
      authorization: ["auditor_read_only", "audit_operator_allowed"],
      dashboard: ["safe_rendering"],
      steps: [
        {
          sequence: 1,
          action: "verify_integrity",
          expectedResult: "verified",
          observedResult: "verified",
          reportSha256: "b".repeat(64),
          mutationClassification: "none",
        },
      ],
      finalState: "verified_with_retention",
    } as const;
    const first = createEventHistoryRehearsalEvidence(input);
    const second = createEventHistoryRehearsalEvidence(input);
    expect(first.json).toBe(second.json);
    expect(first.sha256).toBe(second.sha256);
    expect(first.json).not.toContain("/tmp/");
    expect(first.json).not.toContain("actorId");
    expect(first.json).not.toContain("confirmation");
  });
});
