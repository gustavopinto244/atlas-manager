import { generateKeyPairSync } from "node:crypto";
import { PassThrough } from "node:stream";

import { exportJWK, SignJWT } from "jose";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAdministrativeAccessControl } from "../../src/access-control/composition/create-administrative-access-control.js";
import { createCloudflareAccessAdministrativeAuthentication } from "../../src/access-control/composition/create-cloudflare-access-administrative-authentication.js";
import { createProtectedAdministration } from "../../src/access-control/composition/create-protected-administration.js";
import type { CloudflareAccessAssertionReader } from "../../src/access-control/application/ports/cloudflare-access-assertion-reader.js";
import { createCloudflareAccessConfiguration } from "../../src/access-control/domain/cloudflare-access-configuration.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "../../src/access-control/infrastructure/in-memory-administrative-role-assignment-reader.js";
import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";
import { runAtlasCli } from "../../src/cli/main.js";
import { createEventHistory } from "../../src/event-history/composition/create-event-history.js";
import { createAdministrativeServiceMutationGate } from "../../src/http/administrative-service-mutation-gate.js";
import { FixedAdministrativeRequestAdmission } from "../../src/http/administrative-request-admission.js";
import { parseAdministrativePublicOrigin } from "../../src/http/administrative-public-origin.js";
import { createApp } from "../../src/http/create-app.js";
import { createServiceManagement } from "../../src/service-management/composition/create-service-management.js";
import type { ServerHealthSnapshot } from "../../src/server-health/domain/server-health-snapshot.js";

/** Extracts a request URL without relying on default stringification. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const UNKNOWN_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000002";
const HOST = "atlas.example.com";
const BASE_URL = `https://${HOST}`;
const SERVICE_ID = "task-manager";
const NOW = new Date("2026-08-10T12:00:00.000Z");

function health(): ServerHealthSnapshot {
  return {
    capturedAtIso: NOW.toISOString(),
    uptimeSeconds: 1,
    totalMemoryBytes: 100,
    freeMemoryBytes: 50,
    usedMemoryBytes: 50,
    memoryUsagePercent: 50,
    cpuUsagePercent: 1,
    cpuTemperatureCelsius: null,
    cpuLoadAverage1Minute: 0,
    cpuLoadAverage5Minutes: 0,
    cpuLoadAverage15Minutes: 0,
    diskTotalBytes: 100,
    diskAvailableBytes: 50,
    diskUsedBytes: 50,
    diskUsagePercent: 50,
  };
}

type Express = ReturnType<typeof createApp>;

/**
 * Drives the real `atlas` CLI transport against a real Express application, so
 * every assertion below exercises the whole authority chain: CLI -> HTTP ->
 * Cloudflare Access verification -> RBAC -> mutation admission -> use case ->
 * adapter -> audit.
 */
function supertestFetch(app: Express): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    const method =
      (init?.method ?? "GET").toLowerCase() === "post" ? "post" : "get";
    const pending = request(app)
      [method](`${url.pathname}${url.search}`)
      .set("host", HOST);
    for (const [name, value] of Object.entries(
      (init?.headers ?? {}) as Record<string, string>,
    ))
      pending.set(name, value);
    if (typeof init?.body === "string") pending.send(init.body);
    const response = await pending;
    return new Response(response.text === "" ? null : response.text, {
      status: response.status,
      headers: {
        "content-type":
          (response.headers as Record<string, string>)["content-type"] ??
          "application/json",
      },
    });
  };
}

async function fixture(
  roles: readonly string[] = ["service_operator"],
  initialState: "running" | "stopped" = "running",
) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const configuration = createCloudflareAccessConfiguration({
    teamName: "atlas",
    audience: "atlas-admin",
  });
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    alg: "RS256",
    kid: "K1",
    use: "sig",
  };
  const seconds = Math.floor(NOW.getTime() / 1_000);
  const signAssertion = async (
    claims: Readonly<Record<string, unknown>>,
  ): Promise<string> =>
    new SignJWT({
      aud: configuration.audience,
      exp: seconds + 300,
      iat: seconds,
      iss: configuration.issuer,
      sub: PRINCIPAL_ID,
      type: "app",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "K1", typ: "JWT" })
      .sign(privateKey);

  const clock = { now: vi.fn(() => NOW) };
  const history = createEventHistory();
  const roleAssignmentReader = new InMemoryAdministrativeRoleAssignmentReader({
    assignments: [{ principalId: PRINCIPAL_ID, roles }],
  });
  const authentication = createCloudflareAccessAdministrativeAuthentication({
    configuration,
    clock,
    overrides: {
      fetch: async () =>
        new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 }),
    },
  });
  const serviceManagement = createServiceManagement(
    {
      REGISTERED_SERVICES_JSON: JSON.stringify([
        {
          id: SERVICE_ID,
          displayName: "Task Manager",
          managementAdapter: "mock",
          externalResourceId: "task-manager-target",
          supportedOperations: ["readStatus", "start", "stop", "restart"],
          availabilityPolicy: { mode: "always" },
        },
      ]),
    },
    {
      clock,
      mockStatusConfiguration: [
        { externalResourceId: "task-manager-target", state: initialState },
      ],
    },
  );
  const admission = new FixedAdministrativeRequestAdmission(clock);
  const createProtected = (reader: CloudflareAccessAssertionReader) =>
    createProtectedAdministration({
      accessControl: createAdministrativeAccessControl({
        authenticator:
          authentication.createAuthenticationProviderForRequest(reader),
        roleAssignmentReader,
      }),
      serviceManagement,
      eventHistory: history,
      clock,
    });
  const app = createApp({
    logger: { error: vi.fn() },
    getServerHealth: { execute: vi.fn(async () => health()) },
    administrativePublicOrigin: parseAdministrativePublicOrigin(BASE_URL),
    administrativeServices: {
      admission,
      mutationGate: createAdministrativeServiceMutationGate(),
      createProtectedAdministration: createProtected,
    },
  });
  return { app, signAssertion, history };
}

async function drain(value: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  value.on("data", (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>((resolve) => value.end(resolve));
  return Buffer.concat(chunks).toString("utf8");
}

async function runCli(
  app: Express,
  argv: readonly string[],
  assertion: string | undefined,
): Promise<Readonly<{ code: number; out: string; err: string }>> {
  const output = new PassThrough();
  const errors = new PassThrough();
  const transport = createAtlasHttpTransport({
    baseUrl: BASE_URL,
    fetchImplementation: supertestFetch(app),
    ...(assertion === undefined
      ? {}
      : { administrativeAccessToken: assertion }),
  });
  const code = await runAtlasCli(argv, transport, output, errors);
  return { code, out: await drain(output), err: await drain(errors) };
}

function errorCodeOf(stderr: string): string | undefined {
  return (JSON.parse(stderr) as { error?: { code?: string } }).error?.code;
}

/**
 * Audited registered-service control operations. An empty result proves the
 * mutation never reached the application layer — a stronger statement than an
 * adapter spy, because it is read from the same event history an auditor uses.
 */
async function controlOperations(
  history: Awaited<ReturnType<typeof fixture>>["history"],
): Promise<readonly string[]> {
  const page = await history.getAdministrativeEventHistory.execute({
    limit: 50,
  });
  return (page.events as readonly Readonly<{ operation: string }>[])
    .map((event) => event.operation)
    .filter((operation) => /registered_service/u.test(operation));
}

describe("authenticated mutating CLI — credential verification", () => {
  it("refuses a mutation when no credential is supplied", async () => {
    const value = await fixture();
    const result = await runCli(
      value.app,
      ["services", "restart", SERVICE_ID, "--json"],
      undefined,
    );

    expect(result.code).toBe(3);
    expect(errorCodeOf(result.err)).toBe("administrative_access_denied");
    expect(await controlOperations(value.history)).toEqual([]);
  });

  it("refuses a mutation for a structurally invalid credential", async () => {
    const value = await fixture();
    const result = await runCli(
      value.app,
      ["services", "restart", SERVICE_ID, "--json"],
      "not-a-jwt",
    );

    expect(result.code).toBe(3);
    expect(errorCodeOf(result.err)).toBe("administrative_access_denied");
    expect(await controlOperations(value.history)).toEqual([]);
  });

  it("refuses a mutation for an expired credential", async () => {
    const value = await fixture();
    const seconds = Math.floor(NOW.getTime() / 1_000);
    const expired = await value.signAssertion({
      iat: seconds - 7_200,
      exp: seconds - 3_600,
    });
    const result = await runCli(
      value.app,
      ["services", "restart", SERVICE_ID, "--json"],
      expired,
    );

    expect(result.code).toBe(3);
    expect(errorCodeOf(result.err)).toBe("administrative_access_denied");
    expect(await controlOperations(value.history)).toEqual([]);
  });

  it("refuses a mutation for a credential from the wrong issuer", async () => {
    const value = await fixture();
    const wrongIssuer = await value.signAssertion({
      iss: "https://impostor.cloudflareaccess.com",
    });
    const result = await runCli(
      value.app,
      ["services", "restart", SERVICE_ID, "--json"],
      wrongIssuer,
    );

    expect(result.code).toBe(3);
    expect(errorCodeOf(result.err)).toBe("administrative_access_denied");
    expect(await controlOperations(value.history)).toEqual([]);
  });

  it("refuses a mutation for a credential with the wrong audience", async () => {
    const value = await fixture();
    const wrongAudience = await value.signAssertion({ aud: "another-app" });
    const result = await runCli(
      value.app,
      ["services", "restart", SERVICE_ID, "--json"],
      wrongAudience,
    );

    expect(result.code).toBe(3);
    expect(errorCodeOf(result.err)).toBe("administrative_access_denied");
    expect(await controlOperations(value.history)).toEqual([]);
  });

  it("refuses a mutation for a valid credential naming an unknown principal", async () => {
    const value = await fixture();
    const unknown = await value.signAssertion({ sub: UNKNOWN_PRINCIPAL_ID });
    const result = await runCli(
      value.app,
      ["services", "restart", SERVICE_ID, "--json"],
      unknown,
    );

    expect(result.code).toBe(3);
    expect(errorCodeOf(result.err)).toBe("administrative_access_denied");
    expect(await controlOperations(value.history)).toEqual([]);
  });
});

describe("authenticated mutating CLI — RBAC", () => {
  it("refuses a mutation for a principal without the mutation permission", async () => {
    // `auditor` can read services but holds none of services.start/stop/restart.
    const value = await fixture(["auditor"]);
    const assertion = await value.signAssertion({});
    const result = await runCli(
      value.app,
      ["services", "restart", SERVICE_ID, "--json"],
      assertion,
    );

    expect(result.code).toBe(3);
    expect(errorCodeOf(result.err)).toBe("administrative_access_denied");
    expect(await controlOperations(value.history)).toEqual([]);
  });

  it.each(["start", "stop", "restart"] as const)(
    "permits %s for a principal holding that permission",
    async (operation) => {
      const value = await fixture(
        ["service_operator"],
        operation === "start" ? "stopped" : "running",
      );
      const assertion = await value.signAssertion({});
      const result = await runCli(
        value.app,
        ["services", operation, SERVICE_ID, "--json"],
        assertion,
      );

      expect(result.code).toBe(0);
      expect(
        (JSON.parse(result.out) as { data: { operation: string } }).data,
      ).toMatchObject({
        serviceId: SERVICE_ID,
        operation,
        result: "completed",
        authoritativeRead: "ok",
      });
      // The real mock adapter ran: the authoritative post-mutation state is
      // the one the operation produces, not the one the service started in.
      expect(
        (JSON.parse(result.out) as { data: { state: string } }).data.state,
      ).toBe(operation === "stop" ? "stopped" : "running");
      expect(await controlOperations(value.history)).toContain(
        `${operation}_registered_service`,
      );
    },
  );
});

describe("authenticated mutating CLI — audit", () => {
  it("attributes the mutation to the verified administrative principal, not the shell user", async () => {
    const value = await fixture(["service_operator"]);
    const assertion = await value.signAssertion({});

    await runCli(
      value.app,
      ["services", "restart", SERVICE_ID, "--json"],
      assertion,
    );

    const page = await value.history.getAdministrativeEventHistory.execute({
      limit: 50,
    });
    const events = page.events as readonly Readonly<{
      operation: string;
      source: Readonly<{ kind: string; actorId: string }>;
    }>[];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.source.kind).toBe("administrative");
      // The audit principal comes from the verified assertion. It is never the
      // Unix username, the hostname, or a CLI argument.
      expect(event.source.actorId).toBe(`administrator:${PRINCIPAL_ID}`);
    }
    expect(events.some((event) => event.operation.includes("restart"))).toBe(
      true,
    );
  });

  it("produces the same audited event types as an equivalent dashboard-style API call", async () => {
    const viaCli = await fixture(["service_operator"]);
    const cliAssertion = await viaCli.signAssertion({});
    await runCli(
      viaCli.app,
      ["services", "restart", SERVICE_ID, "--json"],
      cliAssertion,
    );

    const viaApi = await fixture(["service_operator"]);
    const apiAssertion = await viaApi.signAssertion({});
    const apiResponse = await request(viaApi.app)
      .post(`/admin/services/${SERVICE_ID}/actions/restart`)
      .set("host", HOST)
      .set("Cf-Access-Jwt-Assertion", apiAssertion)
      .set("content-type", "application/json")
      .send({ confirmation: "confirm_registered_service_restart" });
    expect(apiResponse.status).toBe(200);

    const typesOf = async (value: Awaited<ReturnType<typeof fixture>>) => {
      const page = await value.history.getAdministrativeEventHistory.execute({
        limit: 50,
      });
      return (page.events as readonly Readonly<{ operation: string }>[])
        .map((event) => event.operation)
        .sort();
    };

    // The CLI additionally performs read operations (pre-check and
    // authoritative re-read), so the API's audited mutation types must be a
    // subset of the CLI's — identical in class, never a separate one.
    const cliTypes = await typesOf(viaCli);
    for (const operation of await typesOf(viaApi))
      expect(cliTypes, operation).toContain(operation);
  });
});

describe("authenticated mutating CLI — mutation admission", () => {
  it("reports a busy service mutation gate as a conflict without retrying", async () => {
    const value = await fixture(["service_operator"]);
    const assertion = await value.signAssertion({});
    const gate = createAdministrativeServiceMutationGate();
    // Occupy the single mutation slot for the lifetime of the request.
    expect(gate.tryAdmit()).toBeDefined();
    const app = createApp({
      logger: { error: vi.fn() },
      getServerHealth: { execute: vi.fn(async () => health()) },
      administrativePublicOrigin: parseAdministrativePublicOrigin(BASE_URL),
      administrativeServices: {
        admission: new FixedAdministrativeRequestAdmission({
          now: () => NOW,
        }),
        mutationGate: gate,
        createProtectedAdministration: (
          reader: CloudflareAccessAssertionReader,
        ) => {
          void reader;
          throw new Error("unreachable: the gate must reject first");
        },
      },
    });

    const result = await runCli(
      app,
      ["services", "restart", SERVICE_ID, "--json"],
      assertion,
    );

    expect(result.code).toBe(4);
    expect(errorCodeOf(result.err)).toBe("operation_conflict");
  });
});
