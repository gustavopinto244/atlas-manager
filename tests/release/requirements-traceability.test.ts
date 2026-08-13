import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

const traceability = readFileSync(
  resolve(ROOT, "docs/release/atlas-manager-v1-requirements-traceability.md"),
  "utf8",
);
const statusConfiguration = JSON.parse(
  readFileSync(
    resolve(ROOT, "scripts/requirements-traceability-status.json"),
    "utf8",
  ),
) as {
  implemented: readonly string[];
  deferredByAcceptedScope: readonly string[];
  implementedWithPhysicalGate: Readonly<Record<string, string>>;
};
const requirementIds = [
  ...readFileSync(resolve(ROOT, "docs/requirements.md"), "utf8").matchAll(
    /^#### ((?:FR|NFR|SEC)-\d+) — /gmu,
  ),
].map((match) => match[1]!);

function requirementRow(document: string, id: string): readonly string[] {
  const line = document
    .split("\n")
    .find((candidate) => candidate.startsWith(`| ${id} `));
  expect(line).toBeDefined();
  return line!
    .split("|")
    .slice(1, -1)
    .map((value) => value.trim());
}

describe("requirements traceability generation", () => {
  it("requires one explicit classification for every normative requirement", () => {
    const classifications = [
      ...statusConfiguration.implemented,
      ...statusConfiguration.deferredByAcceptedScope,
      ...Object.keys(statusConfiguration.implementedWithPhysicalGate),
    ];

    expect(classifications).toHaveLength(requirementIds.length);
    expect(new Set(classifications).size).toBe(requirementIds.length);
    expect(new Set(classifications)).toEqual(new Set(requirementIds));
  });

  it("classifies the delivered administrative CLI as implemented", () => {
    expect(statusConfiguration.deferredByAcceptedScope).not.toContain("FR-037");
    expect(statusConfiguration.implementedWithPhysicalGate).not.toHaveProperty(
      "FR-037",
    );
    expect(requirementRow(traceability, "FR-037")[2]).toBe("implemented");
    expect(traceability).toMatch(
      /\| General administrative CLI\s+\| implemented\s+\|/u,
    );
  });

  it("separates machine-schedule software from physical activation", () => {
    expect(statusConfiguration.implementedWithPhysicalGate["FR-026"]).toBe(
      "future persisted-policy authority decision; physical activation and qualification",
    );
    const row = requirementRow(traceability, "FR-026");

    expect(row[2]).toBe("implemented_with_physical_gate");
    expect(row[3]).toContain("future persisted-policy authority decision");
    expect(row[3]).toContain("physical activation and qualification");
  });

  it("keeps the full versioned snapshot byte-equivalent to detached generation", () => {
    const outputDirectory = mkdtempSync(
      resolve(tmpdir(), "atlas-manager-traceability-"),
    );
    try {
      execFileSync(
        process.execPath,
        ["scripts/generate-requirements-traceability.mjs"],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            RELEASE_ARTIFACT_DIR: outputDirectory,
            RELEASE_SNAPSHOT: "true",
          },
          stdio: "pipe",
        },
      );
      expect(
        readFileSync(
          resolve(
            outputDirectory,
            "atlas-manager-v1-requirements-traceability.md",
          ),
          "utf8",
        ),
      ).toBe(traceability);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
