import { describe, expect, it, vi } from "vitest";

import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";
import { runAtlasCli } from "../../src/cli/main.js";
import { CLI_EXIT_CODES } from "../../src/cli/errors.js";

type DoctorCheck = Readonly<{
  name: string;
  status: string;
  code?: string;
  diagnosticStatus?: string;
}>;

type DoctorReport = Readonly<{
  endpoint: string;
  status: string;
  infrastructureStatus: string;
  checks: readonly DoctorCheck[];
}>;

function diagnosticsResponse(
  checks: readonly Readonly<{ id: string; status: string }>[],
  overallStatus: string,
): Response {
  return new Response(
    JSON.stringify({
      generatedAt: "2026-02-02T10:00:00.000Z",
      overallStatus,
      checks: checks.map((check) => ({
        ...check,
        observedAt: "2026-02-02T10:00:00.000Z",
      })),
    }),
    { status: 200 },
  );
}

describe("atlas doctor", () => {
  // The legacy four-check contract, verbatim. Consumers that read only `name`
  // and `status` must be unaffected by the diagnostics extension.
  it("returns individual failures without hiding passing health checks", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 403 }))
      .mockResolvedValueOnce(new Response("{}", { status: 403 }))
      .mockResolvedValueOnce(new Response("{}", { status: 403 }));
    const transport = createAtlasHttpTransport({ fetchImplementation });

    const report = (await transport.execute(
      "doctor",
      [],
      new AbortController().signal,
    )) as DoctorReport;

    expect(report.endpoint).toBe("127.0.0.1:3000");
    expect(report.status).toBe("partial");
    expect(report.checks.slice(0, 4)).toEqual([
      { name: "atlas_health_live", status: "pass" },
      { name: "atlas_health_server", status: "pass" },
      {
        name: "administrative_overview",
        status: "fail",
        code: "administrative_access_denied",
      },
      {
        name: "administrative_security_posture",
        status: "fail",
        code: "administrative_access_denied",
      },
    ]);
  });

  // A deployment that never enabled the diagnostics capability must keep a
  // working `doctor`, not inherit a failing exit code from an unset flag.
  it("treats a refused diagnostics read as disabled rather than as an outage", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const transport = createAtlasHttpTransport({ fetchImplementation });

    const report = (await transport.execute(
      "doctor",
      [],
      new AbortController().signal,
    )) as DoctorReport;

    expect(report.infrastructureStatus).toBe("disabled");
    expect(report.status).toBe("pass");
    expect(report.checks).toHaveLength(4);
  });

  it("appends infrastructure checks, mapping disabled to pass", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        diagnosticsResponse(
          [
            { id: "atlas.service", status: "ok" },
            { id: "power.posture", status: "disabled" },
            { id: "nginx.config", status: "degraded" },
          ],
          "degraded",
        ),
      );
    const transport = createAtlasHttpTransport({ fetchImplementation });

    const report = (await transport.execute(
      "doctor",
      [],
      new AbortController().signal,
    )) as DoctorReport;

    expect(report.infrastructureStatus).toBe("degraded");
    expect(report.checks).toHaveLength(7);
    const appended = Object.fromEntries(
      report.checks.slice(4).map((check) => [check.name, check.status]),
    );
    expect(appended).toEqual({
      "atlas.service": "pass",
      // Intentionally off is not a failure, even in the legacy vocabulary.
      "power.posture": "pass",
      "nginx.config": "fail",
    });
    expect(report.checks[5]?.diagnosticStatus).toBe("disabled");
  });
});

describe("atlas doctor exit codes", () => {
  function stream() {
    const chunks: string[] = [];
    return {
      write: (value: string) => {
        chunks.push(value);
        return true;
      },
      text: () => chunks.join(""),
    } as unknown as NodeJS.WritableStream & { text(): string };
  }

  async function runDoctorWith(
    overallStatus: string,
    checks: readonly Readonly<{ id: string; status: string }>[],
  ) {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(diagnosticsResponse(checks, overallStatus));
    const output = stream();
    const errors = stream();
    const code = await runAtlasCli(
      ["doctor", "--json"],
      createAtlasHttpTransport({ fetchImplementation }),
      output,
      errors,
    );
    return { code, output: output.text(), errors: errors.text() };
  }

  it("exits 5 on a down diagnosis, after printing the whole report", async () => {
    const result = await runDoctorWith("down", [
      { id: "atlas.service", status: "down" },
      { id: "nginx.service", status: "ok" },
    ]);
    expect(result.code).toBe(CLI_EXIT_CODES.partialFailure);
    // The report must survive the failing exit code: a diagnostic that hides
    // its findings when they matter is useless.
    expect(result.output).toContain("atlas.service");
    expect(result.output).toContain("nginx.service");
  });

  it("exits 5 when the diagnosis could not be determined", async () => {
    const result = await runDoctorWith("unavailable", [
      { id: "atlas.service", status: "unavailable" },
    ]);
    expect(result.code).toBe(CLI_EXIT_CODES.partialFailure);
  });

  it("exits 0 with a warning when degraded", async () => {
    const result = await runDoctorWith("degraded", [
      { id: "atlas.health.server", status: "degraded" },
    ]);
    expect(result.code).toBe(CLI_EXIT_CODES.success);
    expect(result.errors).toContain("degraded");
  });

  it("exits 0 when every capability is intentionally disabled", async () => {
    const result = await runDoctorWith("disabled", [
      { id: "power.posture", status: "disabled" },
    ]);
    expect(result.code).toBe(CLI_EXIT_CODES.success);
  });

  it("exits 0 when everything is healthy", async () => {
    const result = await runDoctorWith("ok", [
      { id: "atlas.service", status: "ok" },
    ]);
    expect(result.code).toBe(CLI_EXIT_CODES.success);
  });
});
