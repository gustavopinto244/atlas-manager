import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

describe("GitHub Actions supply-chain pinning", () => {
  it("pins every third-party action to a commit SHA with a human version", () => {
    const workflow = readFileSync(
      resolve(ROOT, ".github/workflows/ci.yml"),
      "utf8",
    );
    const uses = workflow
      .split("\n")
      .filter((line) => line.trimStart().startsWith("uses:"));

    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(
        /^\s*uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}\s+#\s+v\d+(?:\.\d+)*\s*$/u,
      );
    }
  });

  it("keeps the reviewed release tags bound to their resolved commits", () => {
    const workflow = readFileSync(
      resolve(ROOT, ".github/workflows/ci.yml"),
      "utf8",
    );

    for (const reference of [
      "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
      "actions/setup-go@d35c59abb061a4a6fb18e82ac0862c26744d6ab5 # v5.5.0",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2",
    ]) {
      expect(workflow).toContain(reference);
    }
  });
});
