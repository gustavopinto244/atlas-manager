import { AtlasCliError } from "./errors.js";
import type { AtlasAdministrativeMutationDescriptor } from "./administrative-contract.js";

/**
 * The authenticated administrative client (ADR-031).
 *
 * This is the only place in the CLI that knows about HTTP, Cloudflare Access
 * header names, base-URL policy, redirects, timeouts or response bounds.
 * Command handlers receive `read` and `mutate` and nothing else — they never
 * see `fetch`, a header name, or a credential.
 *
 * Security properties enforced here, all required by ADR-031:
 *
 * - the Access assertion is forwarded only when supplied externally, only in
 *   the `Cf-Access-Jwt-Assertion` header, and never to a non-loopback
 *   plaintext origin;
 * - a mutation against a non-loopback plaintext origin fails closed before any
 *   network activity;
 * - redirects are never followed, so a server cannot bounce the credential to
 *   an origin of its choosing;
 * - responses are read under a byte bound and parsed strictly;
 * - a mutation is never retried automatically, and a lost response is reported
 *   as indeterminate rather than as failure;
 * - no credential value is ever logged, returned, or embedded in an error.
 */

export const ATLAS_DEFAULT_BASE_URL = "http://127.0.0.1:3000";
export const ATLAS_MAX_RESPONSE_BYTES = 262_144;
export const ATLAS_READ_TIMEOUT_MS = 15_000;
export const ATLAS_MUTATION_TIMEOUT_MS = 30_000;

const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";

/**
 * Network failure causes that prove the request never reached the server. Any
 * other failure leaves delivery undecidable, and a mutation must then be
 * reported as indeterminate rather than failed.
 */
const UNDELIVERED_CAUSE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_INVALID_URL",
]);

export type AtlasAdministrativeResponse = Readonly<{
  status: number;
  /** Parsed JSON body, or `undefined` when the body was empty or malformed. */
  body: unknown;
  /** `error.code` from the administrative error envelope, when present. */
  errorCode: string | undefined;
  /** True when the body was present but not strict JSON. */
  malformed: boolean;
}>;

export interface AtlasAdministrativeClient {
  /** Absolute endpoint label (`host:port`) for human output. Never a credential. */
  readonly endpoint: string;
  /**
   * Throws `insecure_transport` when the configured base URL may not carry a
   * mutation. Call before doing any work for a mutating command so the refusal
   * happens with no network activity at all.
   */
  assertMutationAllowed(): void;
  /**
   * Perform an authenticated administrative read. Non-2xx responses are
   * translated into `AtlasCliError` by the caller-supplied mapper, or by the
   * default read mapping.
   */
  read(path: string, signal: AbortSignal): Promise<unknown>;
  /**
   * Perform an authenticated administrative mutation through a canonical route
   * descriptor. Returns the raw response envelope so the caller can apply the
   * mutation error mapping; never retries.
   *
   * `timeoutOverrideMs` raises the bounded timeout for the small number of
   * administrative routes that do their work synchronously inside the request
   * (a manual backup run). It never removes the bound.
   */
  mutate(
    request: AtlasAdministrativeMutationRequest,
    signal: AbortSignal,
    timeoutOverrideMs?: number,
  ): Promise<AtlasAdministrativeResponse>;
  /** Read variant that surfaces the response envelope instead of throwing on 4xx/5xx. */
  readEnvelope(
    path: string,
    signal: AbortSignal,
  ): Promise<AtlasAdministrativeResponse>;
}

export type AtlasAdministrativeMutationRequest = Readonly<{
  descriptor: AtlasAdministrativeMutationDescriptor;
  /** Concrete request path with template parameters already substituted. */
  path: string;
  /**
   * Additional body fields the route's strict body validation requires beyond
   * the confirmation (for example a schedule or retention `policy`). The
   * confirmation is always written first and is never overridable by a payload
   * key, because the confirmation is the route's authorization evidence.
   */
  payload?: Readonly<Record<string, unknown>>;
}>;

export interface AtlasAdministrativeClientOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly administrativeAccessToken?: string;
  readonly readTimeoutMs?: number;
  readonly mutationTimeoutMs?: number;
}

export function createAtlasAdministrativeClient(
  options: AtlasAdministrativeClientOptions = {},
): AtlasAdministrativeClient {
  const baseUrl = parseBaseUrl(options.baseUrl ?? process.env.ATLAS_BASE_URL);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const accessToken =
    options.administrativeAccessToken ??
    process.env.ATLAS_CLOUDFLARE_ACCESS_JWT;
  const readTimeoutMs = options.readTimeoutMs ?? ATLAS_READ_TIMEOUT_MS;
  const mutationTimeoutMs =
    options.mutationTimeoutMs ?? ATLAS_MUTATION_TIMEOUT_MS;
  const credentialAllowed = mayCarryCredential(baseUrl);

  const dispatch = async (
    path: string,
    init: Readonly<{ method: string; body?: string }>,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<Response> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const pending = fetchImplementation(new URL(path, baseUrl), {
        method: init.method,
        redirect: "error",
        signal: combined,
        headers: {
          accept: "application/json",
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(accessToken === undefined || !credentialAllowed
            ? {}
            : { [ACCESS_ASSERTION_HEADER]: accessToken }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
      });
      // The bound is enforced here rather than delegated to the fetch
      // implementation: an implementation that ignores its signal must not be
      // able to hang an operator's terminal indefinitely.
      return await Promise.race([pending, rejectOnAbort(combined, pending)]);
    } catch (error) {
      if (signal.aborted) throw new AtlasCliInterruptedError();
      if (timeout.aborted) throw new AtlasCliTimeoutError();
      throw new AtlasCliNetworkError(isProvenUndelivered(error));
    }
  };

  const assertMutationAllowed = (): void => {
    // Fail closed: a credential must never be offered to, and a mutation must
    // never be attempted against, a plaintext non-loopback origin.
    if (!credentialAllowed)
      throw new AtlasCliError(
        "insecure_transport",
        "Administrative mutations require an HTTPS or loopback ATLAS_BASE_URL",
      );
  };

  return Object.freeze({
    endpoint: endpointLabel(baseUrl),
    assertMutationAllowed,
    read: async (path: string, signal: AbortSignal): Promise<unknown> => {
      const response = await dispatch(
        path,
        { method: "GET" },
        signal,
        readTimeoutMs,
      );
      // Status is classified before the body is touched, so an unparsable
      // error page cannot mask an authorization decision.
      if (response.status === 401 || response.status === 403)
        throw new AtlasCliError(
          "administrative_access_denied",
          "Administrative authentication is required",
        );
      if (!response.ok)
        throw new AtlasCliError(
          "infrastructure_unavailable",
          `Atlas endpoint returned HTTP ${response.status}`,
        );
      const envelope = await readEnvelopeFrom(response);
      if (envelope.malformed)
        throw new AtlasCliError(
          "infrastructure_unavailable",
          "Atlas returned invalid JSON",
        );
      return envelope.body;
    },
    readEnvelope: async (
      path: string,
      signal: AbortSignal,
    ): Promise<AtlasAdministrativeResponse> =>
      readEnvelopeFrom(
        await dispatch(path, { method: "GET" }, signal, readTimeoutMs),
      ),
    mutate: async (
      request: AtlasAdministrativeMutationRequest,
      signal: AbortSignal,
      timeoutOverrideMs?: number,
    ): Promise<AtlasAdministrativeResponse> => {
      assertMutationAllowed();
      return readEnvelopeFrom(
        await dispatch(
          request.path,
          {
            method: request.descriptor.method,
            body: JSON.stringify(mutationBody(request)),
          },
          signal,
          timeoutOverrideMs ?? mutationTimeoutMs,
        ),
      );
    },
  });
}

/**
 * The exact JSON body a mutating administrative route accepts: the canonical
 * confirmation plus whatever additional fields that route's strict body
 * validation requires. The confirmation is written last so no payload key can
 * displace it — a payload never decides its own authorization evidence.
 */
function mutationBody(
  request: AtlasAdministrativeMutationRequest,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...request.payload,
    confirmation: request.descriptor.confirmation,
  });
}

/**
 * Rejects as soon as `signal` aborts. The already-pending request is silenced
 * so that losing the race cannot surface as an unhandled rejection, and any
 * response it eventually produces is discarded unread.
 */
function rejectOnAbort(
  signal: AbortSignal,
  pending: Promise<Response>,
): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const abort = (): void => {
      void pending.then(
        (response) => void response.body?.cancel().catch(() => undefined),
        () => undefined,
      );
      // The concrete reason is never inspected: the caller classifies the
      // outcome from which signal aborted, not from the rejection value.
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Request aborted"),
      );
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Raised when the caller's signal aborted (SIGINT). */
export class AtlasCliInterruptedError extends Error {
  public override readonly name = "AtlasCliInterruptedError";
  public constructor() {
    super("Interrupted");
  }
}

/** Raised when the bounded request timeout elapsed. Delivery is undecidable. */
export class AtlasCliTimeoutError extends Error {
  public override readonly name = "AtlasCliTimeoutError";
  public constructor() {
    super("Request timed out");
  }
}

/** Raised on transport failure. `undelivered` is true only when provable. */
export class AtlasCliNetworkError extends Error {
  public override readonly name = "AtlasCliNetworkError";
  public constructor(public readonly undelivered: boolean) {
    super("Atlas endpoint unavailable");
  }
}

async function readEnvelopeFrom(
  response: Response,
): Promise<AtlasAdministrativeResponse> {
  const text = await readBoundedText(response);
  if (text.length === 0)
    return Object.freeze({
      status: response.status,
      body: undefined,
      errorCode: undefined,
      malformed: false,
    });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Object.freeze({
      status: response.status,
      body: undefined,
      errorCode: undefined,
      malformed: true,
    });
  }
  return Object.freeze({
    status: response.status,
    body,
    errorCode: administrativeErrorCode(body),
    malformed: false,
  });
}

function administrativeErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number.parseInt(declared, 10);
    if (Number.isFinite(length) && length > ATLAS_MAX_RESPONSE_BYTES)
      throw new AtlasCliError(
        "infrastructure_unavailable",
        "Atlas returned an oversized response",
      );
  }
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      size += value.byteLength;
      if (size > ATLAS_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AtlasCliError(
          "infrastructure_unavailable",
          "Atlas returned an oversized response",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isProvenUndelivered(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return false;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" && UNDELIVERED_CAUSE_CODES.has(code);
}

/**
 * Whether the configured base URL may carry the Access assertion at all.
 * HTTPS always may. Plaintext HTTP may only over loopback, which never leaves
 * the host. Plaintext HTTP to any other host never receives the credential,
 * and (see `mutate`) never receives a mutation.
 */
export function mayCarryCredential(baseUrl: URL): boolean {
  if (baseUrl.protocol === "https:") return true;
  return isLoopbackHost(baseUrl.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);
}

export function parseBaseUrl(value: string | undefined): URL {
  let baseUrl: URL;
  try {
    baseUrl = new URL(value ?? ATLAS_DEFAULT_BASE_URL);
  } catch {
    throw new AtlasCliError(
      "invalid_arguments",
      "ATLAS_BASE_URL must be a valid URL",
    );
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new AtlasCliError(
      "invalid_arguments",
      "ATLAS_BASE_URL must use HTTP or HTTPS",
    );
  }
  if (baseUrl.username !== "" || baseUrl.password !== "") {
    throw new AtlasCliError(
      "invalid_arguments",
      "ATLAS_BASE_URL must not contain credentials",
    );
  }
  return baseUrl;
}

export function endpointLabel(baseUrl: URL): string {
  return `${baseUrl.hostname}:${baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80")}`;
}
