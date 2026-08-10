import { PassThrough } from "node:stream";
import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";
import { runAtlasCli } from "../../src/cli/main.js";

/** Extracts a request URL without relying on default stringification. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const BASE_URL = "https://atlas.example.com";
const TARGET_ID = "atlas-config";
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const RUNS_PATH = `${BASE_URL}/admin/backups/targets/${TARGET_ID}/runs`;

const TARGET_RECORD = Object.freeze({
  id: TARGET_ID,
  displayName: "Atlas Configuration",
  kind: "mock",
  scheduleMode: "manual",
  retentionSummary: { keepLastSuccessful: 5, maxSuccessfulAgeDays: null },
  capabilities: { manualRun: true, schedule: true, retention: true },
});

/** The terminal record the synchronous run route answers with. */
function runResult(
  overrides: Readonly<Record<string, unknown>> = {},
  artifact: unknown = {
    fileCount: 12,
    totalBytes: 4096,
    manifestSha256: "a".repeat(64),
    completedAt: "2026-08-10T12:00:05.000Z",
  },
): unknown {
  return {
    run: {
      sequence: 7,
      runId: RUN_ID,
      targetId: TARGET_ID,
      trigger: "manual",
      scheduledFor: null,
      requestedAt: "2026-08-10T12:00:00.000Z",
      startedAt: "2026-08-10T12:00:00.000Z",
      completedAt: "2026-08-10T12:00:05.000Z",
      status: "succeeded",
      artifact,
      failureCode: null,
      ...overrides,
    },
    artifactDirectory: "/var/lib/atlas-manager-backups/atlas-config/run-7",
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorBody(code: string): unknown {
  return { error: { code, message: code } };
}

type AtlasStub = Readonly<{
  /** Response for GET /admin/backups/targets/:id. */
  target?: () => Response | Promise<Response>;
  /** Response for POST /admin/backups/targets/:id/runs. */
  run?: () => Response | Promise<Response>;
  /** Response for GET /admin/backups/runs/:runId. */
  runRead?: () => Response | Promise<Response>;
}>;

function fakeAtlas(stub: AtlasStub = {}) {
  const calls: Array<Readonly<{ method: string; url: string; body: unknown }>> =
    [];
  const implementation = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (method === "GET" && url.includes("/admin/backups/runs/"))
        return stub.runRead === undefined
          ? json(200, {
              runId: RUN_ID,
              targetId: TARGET_ID,
              status: "succeeded",
            })
          : stub.runRead();
      if (method === "GET")
        return stub.target === undefined
          ? json(200, TARGET_RECORD)
          : stub.target();
      return stub.run === undefined ? json(200, runResult()) : stub.run();
    });
  return { implementation, calls };
}

async function drain(value: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  value.on("data", (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>((resolve) => value.end(resolve));
  return Buffer.concat(chunks).toString("utf8");
}

async function runCli(
  argv: readonly string[],
  fetchImplementation: typeof fetch,
  overrides: Readonly<{
    mutationTimeoutMs?: number;
    backupRunTimeoutMs?: number;
  }> = {},
): Promise<Readonly<{ code: number; out: string; err: string }>> {
  const output = new PassThrough();
  const errors = new PassThrough();
  const transport = createAtlasHttpTransport({
    baseUrl: BASE_URL,
    administrativeAccessToken: "externally-issued-assertion",
    fetchImplementation,
    ...(overrides.mutationTimeoutMs === undefined
      ? {}
      : { mutationTimeoutMs: overrides.mutationTimeoutMs }),
    ...(overrides.backupRunTimeoutMs === undefined
      ? {}
      : { backupRunTimeoutMs: overrides.backupRunTimeoutMs }),
  });
  const code = await runAtlasCli(argv, transport, output, errors);
  return { code, out: await drain(output), err: await drain(errors) };
}

function envelope(value: string): {
  status: string;
  command: string;
  data?: unknown;
  error?: { code: string; message: string };
} {
  return JSON.parse(value) as ReturnType<typeof envelope>;
}

describe("atlas backups run — terminal status is never reinterpreted", () => {
  it.each(["failed", "interrupted", "started"] as const)(
    "refuses to report a run with terminal status %s as a completed backup",
    async (status) => {
      const atlas = fakeAtlas({
        run: () =>
          json(
            200,
            runResult(
              {
                status,
                completedAt:
                  status === "started" ? null : "2026-08-10T12:00:05.000Z",
                failureCode:
                  status === "started" ? null : "backup_execution_failed",
              },
              null,
            ),
          ),
      });
      const result = await runCli(
        ["backups", "run", TARGET_ID, "--json"],
        atlas.implementation,
      );

      // A 2xx is not evidence that the backup succeeded. Only the run's own
      // status is, and anything other than `succeeded` is a failure.
      expect(result.code).toBe(1);
      const error = envelope(result.err).error;
      expect(error?.code).toBe("backup_operation_failed");
      expect(error?.message).toContain(status);
      expect(result.out).not.toContain("succeeded");
    },
  );
});

describe("atlas backups run", () => {
  it("runs a registered target through the canonical route with its exact confirmation", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out)).toMatchObject({
      status: "ok",
      command: "backups run",
      data: {
        targetId: TARGET_ID,
        runId: RUN_ID,
        trigger: "manual",
        status: "succeeded",
        fileCount: 12,
        totalBytes: 4096,
      },
    });
    // Pre-check read, then the run. The synchronous response is itself the
    // authoritative result, so there is no separate re-read.
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(atlas.calls[1]).toEqual({
      method: "POST",
      url: RUNS_PATH,
      body: { confirmation: "confirm_registered_backup_run" },
    });
    // The body is exactly the confirmation: no payload, and above all no path.
    expect(
      Object.keys(atlas.calls[1]?.body as Record<string, unknown>),
    ).toEqual(["confirmation"]);
  });

  it("never surfaces the host artifact directory the server returns", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.out).not.toContain("/var/lib/atlas-manager-backups");
    expect(result.out).not.toContain("artifactDirectory");
  });

  it("renders a short human result instead of a raw payload", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "run", TARGET_ID],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      `Backup target: ${TARGET_ID}\nRun: ${RUN_ID}\nStatus: succeeded\nFiles: 12\nBytes: 4096\n`,
    );
  });

  it("reports an unknown target without dispatching a run", async () => {
    const atlas = fakeAtlas({
      target: () => json(404, errorBody("registered_backup_target_not_found")),
    });
    const result = await runCli(
      ["backups", "run", "no-such-target", "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_target_not_found");
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("refuses a target that does not support a manual run without dispatching it", async () => {
    const atlas = fakeAtlas({
      target: () =>
        json(200, {
          ...TARGET_RECORD,
          scheduleMode: "disabled",
          capabilities: { manualRun: false, schedule: false, retention: true },
        }),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe(
      "backup_operation_unsupported",
    );
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("maps an authorization refusal to the access-denied exit code", async () => {
    const atlas = fakeAtlas({ target: () => json(403, errorBody("denied")) });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(3);
    expect(envelope(result.err).error?.code).toBe(
      "administrative_access_denied",
    );
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("maps a busy backup gate to the conflict exit code without retrying", async () => {
    const atlas = fakeAtlas({
      run: () => json(409, errorBody("backup_operation_busy")),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(4);
    expect(envelope(result.err).error?.code).toBe("operation_conflict");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("maps administrative rate limiting to the conflict exit code without retrying", async () => {
    const atlas = fakeAtlas({
      run: () => json(429, errorBody("administrative_request_limited")),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(4);
    expect(envelope(result.err).error?.code).toBe("operation_conflict");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("maps a backup execution failure reported as a server error to an operational failure", async () => {
    const atlas = fakeAtlas({
      run: () => json(503, errorBody("backup_operation_unavailable")),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_operation_failed");
  });

  it("rejects a malformed run response", async () => {
    const atlas = fakeAtlas({
      run: () =>
        new Response("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_operation_failed");
  });

  it("rejects a run response of the wrong shape", async () => {
    const atlas = fakeAtlas({ run: () => json(200, { unexpected: true }) });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_operation_failed");
  });

  it("reports a provably undelivered run as unavailable infrastructure", async () => {
    const atlas = fakeAtlas({
      run: () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          }),
        });
      },
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("infrastructure_unavailable");
  });

  it("reports a possibly delivered run as indeterminate, never retries, and names the recovery commands", async () => {
    const atlas = fakeAtlas({
      run: () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("socket hang up"), {
            code: "ECONNRESET",
          }),
        });
      },
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    const error = envelope(result.err).error;
    expect(error?.code).toBe("mutation_outcome_unknown");
    expect(error?.message).toContain("may still have been applied");
    expect(error?.message).toContain("atlas backups runs");
    expect(error?.message).toContain("atlas backups run-status");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("reports a timed-out run as indeterminate and never retries", async () => {
    const atlas = fakeAtlas({
      run: async () =>
        new Promise<Response>(() => {
          /* never settles; the bounded timeout must fire */
        }),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
      { backupRunTimeoutMs: 20 },
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("mutation_outcome_unknown");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("does not abandon a synchronous run at the general mutation bound", async () => {
    let settle: ((value: Response) => void) | undefined;
    const atlas = fakeAtlas({
      run: async () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
          // Well past the 30 ms mutation bound this run is configured with.
          setTimeout(() => resolve(json(200, runResult())), 120);
        }),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
      { mutationTimeoutMs: 30 },
    );

    expect(settle).toBeDefined();
    // The backup bound is the larger of the two, so a run that outlives the
    // general mutation timeout still completes rather than being reported as
    // an indeterminate outcome.
    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({ status: "succeeded" });
  });

  it("reports a clean cancellation when interrupted before dispatch", async () => {
    const atlas = fakeAtlas({
      target: async () =>
        new Promise<Response>(() => {
          setImmediate(() => process.emit("SIGINT"));
        }),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(130);
    expect(envelope(result.err).error?.code).toBe("interrupted");
    expect(atlas.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("reports an indeterminate outcome when interrupted after dispatch", async () => {
    const atlas = fakeAtlas({
      run: async () =>
        new Promise<Response>(() => {
          setImmediate(() => process.emit("SIGINT"));
        }),
    });
    const result = await runCli(
      ["backups", "run", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(130);
    const error = envelope(result.err).error;
    expect(error?.code).toBe("mutation_interrupted_outcome_unknown");
    expect(error?.message).toContain("atlas backups run-status");
  });
});

describe("atlas backups run arguments", () => {
  it.each([
    [[] as string[], "backup target id is required"],
    [[TARGET_ID, "extra"], "Unexpected argument"],
    // A backup addresses a registered target, never a filesystem location.
    [["--source", "/etc"], "Unknown option"],
    [["--destination", "/mnt/backup"], "Unknown option"],
    [["--path", "/etc"], "Unknown option"],
    [["--pm2"], "Unknown option"],
    [["/var/lib/atlas"], "Invalid backup target id"],
    [["Not_A_Target"], "Invalid backup target id"],
  ])("rejects %j as a usage error", async (args, expected) => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "run", ...args, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(2);
    expect(envelope(result.err).error?.code).toBe("invalid_arguments");
    expect(envelope(result.err).error?.message).toContain(expected);
    expect(atlas.implementation).not.toHaveBeenCalled();
  });
});

describe("atlas backups run-status", () => {
  it("reads a single run through the canonical read route", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "run-status", RUN_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out)).toMatchObject({
      status: "ok",
      command: "backups run-status",
      data: { runId: RUN_ID, status: "succeeded" },
    });
    expect(atlas.calls).toEqual([
      {
        method: "GET",
        url: `${BASE_URL}/admin/backups/runs/${RUN_ID}`,
        body: undefined,
      },
    ]);
  });

  it("reports an unknown run as a not-found operational failure", async () => {
    const atlas = fakeAtlas({
      runRead: () => json(404, errorBody("backup_run_not_found")),
    });
    const result = await runCli(
      ["backups", "run-status", RUN_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_run_not_found");
  });

  it("maps an authorization refusal to the access-denied exit code", async () => {
    const atlas = fakeAtlas({
      runRead: () =>
        json(401, errorBody("administrative_authentication_required")),
    });
    const result = await runCli(
      ["backups", "run-status", RUN_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(3);
    expect(envelope(result.err).error?.code).toBe(
      "administrative_access_denied",
    );
  });

  it.each([
    [[] as string[], "run id is required"],
    [["not-a-uuid"], "Invalid run id"],
    [[RUN_ID, "extra"], "Unexpected argument"],
    [["--force"], "Unknown option"],
  ])("rejects %j as a usage error", async (args, expected) => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "run-status", ...args, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(2);
    expect(envelope(result.err).error?.message).toContain(expected);
    expect(atlas.implementation).not.toHaveBeenCalled();
  });
});
