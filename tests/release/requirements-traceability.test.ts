import { readFileSync } from "node:fs";
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
  deferredByAcceptedScope: readonly string[];
  implementedWithPhysicalGate: Readonly<Record<string, string>>;
};

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
});
