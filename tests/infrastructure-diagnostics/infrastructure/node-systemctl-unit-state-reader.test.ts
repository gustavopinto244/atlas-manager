import { describe, expect, it, vi } from "vitest";

import {
  DiagnosticExecExitError,
  type DiagnosticExecFile,
} from "../../../src/infrastructure-diagnostics/infrastructure/bounded-diagnostic-exec.js";
import { NodeSystemctlUnitStateReader } from "../../../src/infrastructure-diagnostics/infrastructure/node-systemctl-unit-state-reader.js";

function execReturning(stdout: string): DiagnosticExecFile {
  return vi.fn(async () => Object.freeze({ stdout, stderr: "" }));
}

function execRejecting(error: unknown): DiagnosticExecFile {
  return vi.fn(async () => {
    throw error;
  });
}

describe("NodeSystemctlUnitStateReader", () => {
  it("invokes only the read-only show verb, with a fixed constant argv", async () => {
    const runFile = execReturning("active\nrunning\nenabled\n");
    await new NodeSystemctlUnitStateReader(runFile).read("atlas-manager");
    expect(runFile).toHaveBeenCalledWith(
      "systemctl",
      [
        "show",
        "atlas-manager",
        "--property=ActiveState,SubState,UnitFileState",
        "--value",
      ],
      {
        encoding: "utf8",
        maxBuffer: 65_536,
        shell: false,
        timeout: 3_000,
        windowsHide: true,
      },
    );
  });

  // The verbs that would turn a diagnostic into a mutation.
  it("never invokes a lifecycle verb for any unit in the closed union", async () => {
    const runFile = execReturning("active\nrunning\nenabled\n");
    const reader = new NodeSystemctlUnitStateReader(runFile);
    for (const unit of ["atlas-manager", "nginx", "cloudflared"] as const)
      await reader.read(unit);
    for (const call of vi.mocked(runFile).mock.calls) {
      const argv = call[1];
      for (const forbidden of [
        "start",
        "stop",
        "restart",
        "reload",
        "enable",
        "disable",
        "mask",
        "kill",
      ])
        expect(argv).not.toContain(forbidden);
    }
  });

  it("reports an active unit as observed", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(
        execReturning("active\nrunning\nenabled\n"),
      ).read("nginx"),
    ).resolves.toEqual({
      outcome: "observed",
      activeState: "active",
      subState: "running",
      unitFileState: "enabled",
    });
  });

  it("reports a failed unit as observed rather than as an error", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(
        execReturning("failed\nfailed\nenabled\n"),
      ).read("cloudflared"),
    ).resolves.toMatchObject({ outcome: "observed", activeState: "failed" });
  });

  it("reports a disabled unit file verbatim for the caller to classify", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(
        execReturning("inactive\ndead\ndisabled\n"),
      ).read("cloudflared"),
    ).resolves.toMatchObject({ unitFileState: "disabled" });
  });

  it("treats an errno permission refusal as undetermined and privileged", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(
        execRejecting(Object.assign(new Error("denied"), { code: "EACCES" })),
      ).read("atlas-manager"),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "systemd_permission_denied",
      requiresPrivilege: true,
    });
  });

  it("treats a permission refusal printed on stderr as undetermined and privileged", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(
        execRejecting(
          new DiagnosticExecExitError(1, "", "Access denied for unit"),
        ),
      ).read("atlas-manager"),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "systemd_permission_denied",
      requiresPrivilege: true,
    });
  });

  it("treats a timeout as undetermined, not as an outage", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(
        execRejecting(
          Object.assign(new Error("timed out"), {
            killed: true,
            signal: "SIGTERM",
          }),
        ),
      ).read("nginx"),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "systemd_timeout",
      requiresPrivilege: false,
    });
  });

  it("treats an output-limit overflow as undetermined", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(
        execRejecting(
          Object.assign(new Error("too much"), {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          }),
        ),
      ).read("nginx"),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "systemd_output_invalid",
      requiresPrivilege: false,
    });
  });

  it("treats a missing systemctl as undetermined, never as privileged", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(
        execRejecting(Object.assign(new Error("missing"), { code: "ENOENT" })),
      ).read("nginx"),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "systemd_unavailable",
      requiresPrivilege: false,
    });
  });

  it("treats truncated output as invalid rather than inventing a state", async () => {
    await expect(
      new NodeSystemctlUnitStateReader(execReturning("active\n")).read("nginx"),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "systemd_output_invalid",
      requiresPrivilege: false,
    });
  });
});
