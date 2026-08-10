import { describe, expect, it, vi } from "vitest";

import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";
import { CLI_EXIT_CODES } from "../../src/cli/errors.js";
import { runAtlasCli } from "../../src/cli/main.js";

const CHECKS = [
  { id: "atlas.service", status: "ok" },
  { id: "atlas.health.live", status: "ok" },
  { id: "listener.atlas", status: "degraded" },
  { id: "scheduler.backup", status: "disabled" },
  { id: "nginx.service", status: "ok" },
  { id: "nginx.config", status: "down" },
  { id: "tunnel.cloudflared.service", status: "disabled" },
] as const;

type Subset = Readonly<{
  endpoint: string;
  overallStatus: string;
  checks: readonly Readonly<{ id: string }>[];
}>;

function diagnosticsFetch(
  checks: readonly Readonly<{ id: string; status: string }>[] = CHECKS,
  overallStatus = "down",
) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        generatedAt: "2026-02-02T10:00:00.000Z",
        overallStatus,
        checks: checks.map((check) => ({
          ...check,
          observedAt: "2026-02-02T10:00:00.000Z",
        })),
      }),
      { status: 200 },
    ),
  );
}

async function run(command: string) {
  const fetchImplementation = diagnosticsFetch();
  const transport = createAtlasHttpTransport({ fetchImplementation });
  const value = (await transport.execute(
    command,
    [],
    new AbortController().signal,
  )) as Subset;
  return { value, fetchImplementation };
}

describe("infrastructure diagnostics CLI commands", () => {
  it("reads the whole report for infra status", async () => {
    const { value, fetchImplementation } = await run("infra status");
    expect(value.checks.map((check) => check.id)).toEqual(
      CHECKS.map((check) => check.id),
    );
    expect(value.overallStatus).toBe("down");
    expect(value.endpoint).toBe("127.0.0.1:3000");
    // One report, one request. Every command is a view over the same fetch.
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const target = fetchImplementation.mock.calls[0]?.[0];
    expect(target).toBeInstanceOf(URL);
    expect((target as URL).pathname).toBe("/admin/infrastructure/diagnostics");
  });

  it("filters infra listeners to the listener namespace", async () => {
    const { value } = await run("infra listeners");
    expect(value.checks.map((check) => check.id)).toEqual(["listener.atlas"]);
    expect(value.overallStatus).toBe("degraded");
  });

  it("filters nginx status to the nginx namespace", async () => {
    const { value } = await run("nginx status");
    expect(value.checks.map((check) => check.id)).toEqual([
      "nginx.service",
      "nginx.config",
    ]);
    expect(value.overallStatus).toBe("down");
  });

  it("filters nginx test to the configuration check alone", async () => {
    const { value } = await run("nginx test");
    expect(value.checks.map((check) => check.id)).toEqual(["nginx.config"]);
  });

  it("filters tunnel status to the tunnel namespace", async () => {
    const { value } = await run("tunnel status");
    expect(value.checks.map((check) => check.id)).toEqual([
      "tunnel.cloudflared.service",
    ]);
    // Every selected check is intentionally disabled, so the subset is calm.
    expect(value.overallStatus).toBe("disabled");
  });

  // A subset must be judged on its own checks. A cloudflared outage is not
  // `atlas nginx test`'s problem, and must not fail it.
  it("never judges a subset by a check outside it", async () => {
    const fetchImplementation = diagnosticsFetch(
      [
        { id: "nginx.config", status: "ok" },
        { id: "tunnel.cloudflared.service", status: "down" },
      ],
      "down",
    );
    const transport = createAtlasHttpTransport({ fetchImplementation });
    const value = (await transport.execute(
      "nginx test",
      [],
      new AbortController().signal,
    )) as Subset;
    expect(value.overallStatus).toBe("ok");
  });

  it("rejects an unrecognized report rather than reporting a false healthy", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), {
        status: 200,
      }),
    );
    const transport = createAtlasHttpTransport({ fetchImplementation });
    await expect(
      transport.execute("infra status", [], new AbortController().signal),
    ).rejects.toThrow(/unrecognized diagnostics report/u);
  });
});

describe("infrastructure diagnostics CLI exit codes", () => {
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

  async function exitCodeFor(
    argv: readonly string[],
    checks: readonly Readonly<{ id: string; status: string }>[],
    overallStatus: string,
  ) {
    const output = stream();
    const errors = stream();
    const code = await runAtlasCli(
      [...argv, "--json"],
      createAtlasHttpTransport({
        fetchImplementation: diagnosticsFetch(checks, overallStatus),
      }),
      output,
      errors,
    );
    return { code, output: output.text() };
  }

  it("exits 5 for each diagnostics command on a down subset", async () => {
    for (const argv of [
      ["infra", "status"],
      ["infra", "listeners"],
      ["nginx", "status"],
      ["nginx", "test"],
      ["tunnel", "status"],
    ]) {
      const result = await exitCodeFor(
        argv,
        [
          { id: "listener.atlas", status: "down" },
          { id: "nginx.config", status: "down" },
          { id: "tunnel.cloudflared.service", status: "down" },
          { id: "atlas.service", status: "down" },
        ],
        "down",
      );
      expect(result.code, argv.join(" ")).toBe(CLI_EXIT_CODES.partialFailure);
      // The report is still printed in full.
      expect(result.output, argv.join(" ")).toContain("checks");
    }
  });

  it("exits 0 when the selected subset is entirely disabled", async () => {
    const result = await exitCodeFor(
      ["tunnel", "status"],
      [{ id: "tunnel.cloudflared.service", status: "disabled" }],
      "disabled",
    );
    expect(result.code).toBe(CLI_EXIT_CODES.success);
  });

  it("exits 0 when healthy", async () => {
    const result = await exitCodeFor(
      ["nginx", "test"],
      [{ id: "nginx.config", status: "ok" }],
      "ok",
    );
    expect(result.code).toBe(CLI_EXIT_CODES.success);
  });

  it("surfaces status's nested infrastructure diagnosis in the exit code", async () => {
    const output = stream();
    const errors = stream();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            generatedAt: "2026-02-02T10:00:00.000Z",
            overallStatus: "down",
            checks: [
              {
                id: "atlas.service",
                status: "down",
                observedAt: "2026-02-02T10:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const code = await runAtlasCli(
      ["status", "--json"],
      createAtlasHttpTransport({ fetchImplementation }),
      output,
      errors,
    );
    expect(code).toBe(CLI_EXIT_CODES.partialFailure);
    expect(output.text()).toContain("atlasManager");
    expect(output.text()).toContain("infrastructure");
  });
});
