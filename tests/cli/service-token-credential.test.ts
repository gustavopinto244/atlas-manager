import { describe, expect, it } from "vitest";

import { createAtlasAdministrativeClient } from "../../src/cli/administrative-client.js";
import { AtlasCliError } from "../../src/cli/errors.js";

/** Asserts the refusal is the typed CLI error carrying `code`, not any throw. */
function expectRefusal(run: () => unknown): AtlasCliError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AtlasCliError);
    expect((error as AtlasCliError).code).toBe("invalid_arguments");
    return error as AtlasCliError;
  }
  throw new Error("expected a refusal");
}

const CLIENT_ID = "0123456789abcdef0123456789abcdef.access";
const CLIENT_SECRET = "s3cr3t-service-token-value";
const ASSERTION = "header.payload.signature";

/**
 * Captures the headers of the single request the client issues, so a test can
 * assert on what was actually put on the wire rather than on intent.
 */
function capturingFetch(): {
  readonly fetch: typeof fetch;
  headersOf: () => Headers;
} {
  let seen: Headers | undefined;
  const implementation = ((input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    seen = new Headers(init?.headers);
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return {
    fetch: implementation,
    headersOf: () => {
      if (seen === undefined) throw new Error("no request was issued");
      return seen;
    },
  };
}

async function readWith(
  options: Parameters<typeof createAtlasAdministrativeClient>[0],
): Promise<Headers> {
  const capture = capturingFetch();
  const client = createAtlasAdministrativeClient({
    baseUrl: "https://admin.example.test",
    fetchImplementation: capture.fetch,
    ...options,
  });
  await client.read("/admin/overview", new AbortController().signal);
  return capture.headersOf();
}

describe("CLI Cloudflare Access service-token credential (ADR-034)", () => {
  it("sends the service-token pair in its own headers", async () => {
    const headers = await readWith({
      serviceTokenClientId: CLIENT_ID,
      serviceTokenClientSecret: CLIENT_SECRET,
    });
    expect(headers.get("cf-access-client-id")).toBe(CLIENT_ID);
    expect(headers.get("cf-access-client-secret")).toBe(CLIENT_SECRET);
    // The service token is not a human assertion and must not masquerade as one.
    expect(headers.get("cf-access-jwt-assertion")).toBeNull();
  });

  it("still accepts the deprecated human assertion on its own", async () => {
    const headers = await readWith({ administrativeAccessToken: ASSERTION });
    expect(headers.get("cf-access-jwt-assertion")).toBe(ASSERTION);
    expect(headers.get("cf-access-client-id")).toBeNull();
  });

  // A host configured for non-interactive use must not act as whichever
  // operator last exported a JWT into the environment.
  it("prefers the service token when both credentials are present", async () => {
    const headers = await readWith({
      serviceTokenClientId: CLIENT_ID,
      serviceTokenClientSecret: CLIENT_SECRET,
      administrativeAccessToken: ASSERTION,
    });
    expect(headers.get("cf-access-client-id")).toBe(CLIENT_ID);
    expect(headers.get("cf-access-jwt-assertion")).toBeNull();
  });

  it.each([
    ["id without secret", { serviceTokenClientId: CLIENT_ID }],
    ["secret without id", { serviceTokenClientSecret: CLIENT_SECRET }],
  ])("fails closed on half a service token (%s)", (_label, options) => {
    expectRefusal(() =>
      createAtlasAdministrativeClient({
        baseUrl: "https://admin.example.test",
        ...options,
      }),
    );
  });

  // Falling back would silently reattribute every subsequent action to a
  // person, which is exactly what the two identities exist to prevent.
  it("does not fall back to the human assertion when the pair is incomplete", () => {
    expectRefusal(() =>
      createAtlasAdministrativeClient({
        baseUrl: "https://admin.example.test",
        serviceTokenClientId: CLIENT_ID,
        administrativeAccessToken: ASSERTION,
      }),
    );
  });

  it("never echoes a credential value in the failure message", () => {
    const error = expectRefusal(() =>
      createAtlasAdministrativeClient({
        baseUrl: "https://admin.example.test",
        serviceTokenClientSecret: CLIENT_SECRET,
      }),
    );
    expect(error.message).not.toContain(CLIENT_SECRET);
  });

  it.each([
    ["a newline", "value\nX-Injected: 1"],
    ["a carriage return", "value\rX-Injected: 1"],
    ["a NUL", "value\u0000X"],
    ["surrounding whitespace", " value "],
    ["an empty value", ""],
  ])("rejects a service-token secret containing %s", (_label, secret) => {
    expectRefusal(() =>
      createAtlasAdministrativeClient({
        baseUrl: "https://admin.example.test",
        serviceTokenClientId: CLIENT_ID,
        serviceTokenClientSecret: secret,
      }),
    );
  });

  // The transport rule that already governed the human assertion applies
  // unchanged to the service token: plaintext off-host never sees a credential.
  it("withholds the service token from a plaintext non-loopback origin", async () => {
    const capture = capturingFetch();
    const client = createAtlasAdministrativeClient({
      baseUrl: "http://atlas.example.test",
      fetchImplementation: capture.fetch,
      serviceTokenClientId: CLIENT_ID,
      serviceTokenClientSecret: CLIENT_SECRET,
    });
    await client.read("/admin/overview", new AbortController().signal);
    const headers = capture.headersOf();
    expect(headers.get("cf-access-client-id")).toBeNull();
    expect(headers.get("cf-access-client-secret")).toBeNull();
  });

  it("carries the service token to a loopback origin", async () => {
    const capture = capturingFetch();
    const client = createAtlasAdministrativeClient({
      baseUrl: "http://127.0.0.1:3000",
      fetchImplementation: capture.fetch,
      serviceTokenClientId: CLIENT_ID,
      serviceTokenClientSecret: CLIENT_SECRET,
    });
    await client.read("/admin/overview", new AbortController().signal);
    expect(capture.headersOf().get("cf-access-client-id")).toBe(CLIENT_ID);
  });
});
