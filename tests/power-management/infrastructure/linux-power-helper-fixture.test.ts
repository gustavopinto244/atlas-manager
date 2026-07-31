import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const FIXTURE = "tests/fixtures/linux-power-helper-fixture.mjs";
const REQUEST = JSON.stringify({
  version: 1,
  operation: "read_wake_alarm",
  requestedAt: "2026-08-01T12:00:00.000Z",
});

describe("test-only Linux power-helper fixture", () => {
  it.each([
    "success",
    "malformed_json",
    "multiple_lines",
    "operation_mismatch",
    "unsupported_version",
  ])("supports harmless deterministic mode %s", async (mode) => {
    const result = await runFixture(mode);
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.error).toBe("");
  });

  it("supports a deterministic nonzero exit without touching the host", async () => {
    const result = await runFixture("nonzero_exit");
    expect(result.code).toBe(7);
    expect(result.output).toBe("");
  });
});

function runFixture(mode: string): Promise<{
  readonly code: number | null;
  readonly output: string;
  readonly error: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE], {
      cwd: process.cwd(),
      env: { ATLAS_POWER_HELPER_FIXTURE_MODE: mode },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      error += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output, error }));
    child.stdin.end(`${REQUEST}\n`);
  });
}
