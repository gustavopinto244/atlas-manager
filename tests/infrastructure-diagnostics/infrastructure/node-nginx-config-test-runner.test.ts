import { describe, expect, it, vi } from "vitest";

import {
  DiagnosticExecExitError,
  type DiagnosticExecFile,
} from "../../../src/infrastructure-diagnostics/infrastructure/bounded-diagnostic-exec.js";
import { NodeNginxConfigTestRunner } from "../../../src/infrastructure-diagnostics/infrastructure/node-nginx-config-test-runner.js";

const SUCCESS_STDERR =
  "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\n" +
  "nginx: configuration file /etc/nginx/nginx.conf test is successful\n";

function execReturning(stderr: string): DiagnosticExecFile {
  return vi.fn(async () => Object.freeze({ stdout: "", stderr }));
}

function execRejecting(error: unknown): DiagnosticExecFile {
  return vi.fn(async () => {
    throw error;
  });
}

describe("NodeNginxConfigTestRunner", () => {
  it("invokes only the read-only test flag, with a bounded fixed argv", async () => {
    const runFile = execReturning(SUCCESS_STDERR);
    await new NodeNginxConfigTestRunner(runFile).run();
    expect(runFile).toHaveBeenCalledWith("nginx", ["-t"], {
      encoding: "utf8",
      maxBuffer: 65_536,
      shell: false,
      timeout: 5_000,
      windowsHide: true,
    });
  });

  // `-s reload` is the mutation this adapter must never be able to become.
  it("never passes a signal flag", async () => {
    const runFile = execReturning(SUCCESS_STDERR);
    await new NodeNginxConfigTestRunner(runFile).run();
    const argv = vi.mocked(runFile).mock.calls[0]![1];
    expect(argv).not.toContain("-s");
    expect(argv).not.toContain("reload");
    expect(argv).toHaveLength(1);
  });

  it("reports a successful configuration test as valid", async () => {
    await expect(
      new NodeNginxConfigTestRunner(execReturning(SUCCESS_STDERR)).run(),
    ).resolves.toEqual({ outcome: "valid" });
  });

  it("extracts only the emergency line from a failed test", async () => {
    const stderr =
      'nginx: [emerg] unknown directive "proxy_passs" in /etc/nginx/sites-enabled/atlas:14\n' +
      "nginx: configuration file /etc/nginx/nginx.conf test failed\n";
    const outcome = await new NodeNginxConfigTestRunner(
      execRejecting(new DiagnosticExecExitError(1, "", stderr)),
    ).run();
    expect(outcome).toEqual({
      outcome: "invalid",
      detail:
        'nginx: [emerg] unknown directive "proxy_passs" in /etc/nginx/sites-enabled/atlas:14',
    });
  });

  it("bounds the emergency detail so a long line cannot inflate the response", async () => {
    const stderr = `nginx: [emerg] ${"x".repeat(4_000)}`;
    const outcome = await new NodeNginxConfigTestRunner(
      execRejecting(new DiagnosticExecExitError(1, "", stderr)),
    ).run();
    expect(outcome.outcome).toBe("invalid");
    if (outcome.outcome === "invalid")
      expect(outcome.detail.length).toBeLessThanOrEqual(500);
  });

  it("never emits the full stderr blob alongside the emergency line", async () => {
    const stderr =
      "nginx: [emerg] bind() to 0.0.0.0:80 failed\n" +
      "nginx: configuration file /etc/nginx/private-internal-map.conf test failed\n";
    const outcome = await new NodeNginxConfigTestRunner(
      execRejecting(new DiagnosticExecExitError(1, "", stderr)),
    ).run();
    expect(JSON.stringify(outcome)).not.toContain("private-internal-map");
  });

  it("treats a permission refusal as undetermined and privileged", async () => {
    await expect(
      new NodeNginxConfigTestRunner(
        execRejecting(Object.assign(new Error("denied"), { code: "EACCES" })),
      ).run(),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "nginx_permission_denied",
      requiresPrivilege: true,
    });
  });

  it("treats a root-only refusal printed on stderr as privileged", async () => {
    await expect(
      new NodeNginxConfigTestRunner(
        execRejecting(
          new DiagnosticExecExitError(
            1,
            "",
            "nginx: [alert] could not open error log file: open() failed (13: Permission denied)",
          ),
        ),
      ).run(),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "nginx_permission_denied",
      requiresPrivilege: true,
    });
  });

  it("treats a missing nginx binary as undetermined, never as a broken config", async () => {
    await expect(
      new NodeNginxConfigTestRunner(
        execRejecting(Object.assign(new Error("missing"), { code: "ENOENT" })),
      ).run(),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "nginx_unavailable",
      requiresPrivilege: false,
    });
  });

  it("treats a timeout as undetermined", async () => {
    await expect(
      new NodeNginxConfigTestRunner(
        execRejecting(
          Object.assign(new Error("slow"), {
            killed: true,
            signal: "SIGTERM",
          }),
        ),
      ).run(),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "nginx_timeout",
      requiresPrivilege: false,
    });
  });

  it("treats a zero exit with unrecognizable output as undetermined", async () => {
    await expect(
      new NodeNginxConfigTestRunner(execReturning("something else")).run(),
    ).resolves.toEqual({
      outcome: "undetermined",
      code: "nginx_output_invalid",
      requiresPrivilege: false,
    });
  });
});
