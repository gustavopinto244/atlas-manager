import { importJWK, type JWK } from "jose";

import type { CloudflareAccessConfiguration } from "../domain/cloudflare-access-configuration.js";
import type { CloudflareAccessJwksProvider as CloudflareAccessJwksProviderPort } from "../application/ports/cloudflare-access-jwks-provider.js";

const CACHE_LIFETIME_MS = 10 * 60 * 1_000;
const FAILURE_COOLDOWN_MS = 30 * 1_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_KEYS = 16;
const JWKS_PATH = "/cdn-cgi/access/certs";
const MAX_KID_LENGTH = 128;
const KID_PATTERN = /^[\x21-\x7e]+$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const ALLOWED_KEY_FIELDS = new Set([
  "alg",
  "e",
  "ext",
  "key_ops",
  "kid",
  "kty",
  "n",
  "use",
]);

export const CLOUDFLARE_ACCESS_JWKS_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
export const CLOUDFLARE_ACCESS_JWKS_MAX_RESPONSE_BYTES = MAX_RESPONSE_BYTES;
export const CLOUDFLARE_ACCESS_JWKS_CACHE_LIFETIME_MS = CACHE_LIFETIME_MS;
export const CLOUDFLARE_ACCESS_JWKS_FAILURE_COOLDOWN_MS = FAILURE_COOLDOWN_MS;

export type CloudflareAccessJwksFetch = (
  input: string,
  init: Readonly<{
    method: "GET";
    redirect: "error";
    credentials: "omit";
    signal: AbortSignal;
  }>,
) => Promise<Response>;

export type CloudflareAccessJwksProviderOptions = Readonly<{
  fetch?: CloudflareAccessJwksFetch;
}>;

export class CloudflareAccessJwksUnavailableError extends Error {
  public override readonly name = "CloudflareAccessJwksUnavailableError";
  public constructor() {
    super("Cloudflare Access signing keys are unavailable");
    Object.freeze(this);
  }
}

export class CloudflareAccessJwksInvalidError extends Error {
  public override readonly name = "CloudflareAccessJwksInvalidError";
  public constructor() {
    super("Cloudflare Access signing keys are invalid");
    Object.freeze(this);
  }
}

export class CloudflareAccessJwksKeyNotFoundError extends Error {
  public override readonly name = "CloudflareAccessJwksKeyNotFoundError";
  public constructor() {
    super("Cloudflare Access signing key is not available");
    Object.freeze(this);
  }
}

type CachedKeys = ReadonlyMap<string, CryptoKey>;

export class CloudflareAccessJwksProvider implements CloudflareAccessJwksProviderPort {
  readonly #configuration: CloudflareAccessConfiguration;
  readonly #fetch: CloudflareAccessJwksFetch;
  #cachedKeys: CachedKeys | undefined;
  #cacheExpiresAt = 0;
  #failedUntil = 0;
  #inFlightRefresh: Promise<void> | undefined;
  #lastSuccessfulRefreshAt = 0;

  public constructor(
    configuration: CloudflareAccessConfiguration,
    options: CloudflareAccessJwksProviderOptions = {},
  ) {
    this.#configuration = configuration;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    Object.freeze(this);
  }

  public async resolveKey(
    kid: string,
    verificationTime: Date,
  ): Promise<CryptoKey> {
    const time = verificationTime.getTime();
    const cachedKey = this.#getCachedKey(kid, time);
    if (cachedKey !== undefined) return cachedKey;

    if (time < this.#failedUntil)
      throw new CloudflareAccessJwksUnavailableError();
    await this.#refresh(time);

    const refreshedKey = this.#getCachedKey(kid, time);
    if (refreshedKey === undefined)
      throw new CloudflareAccessJwksKeyNotFoundError();
    return refreshedKey;
  }

  public async checkReadiness(
    verificationTime: Date,
  ): Promise<"ready" | "unavailable"> {
    const result = await this.readReadiness(verificationTime);
    return result === "unavailable" ? "unavailable" : "ready";
  }

  public async readReadiness(
    verificationTime: Date,
  ): Promise<"ready" | "ready_with_cached_keys" | "unavailable"> {
    const time = verificationTime.getTime();
    if (this.#cachedKeys !== undefined && time < this.#cacheExpiresAt)
      return "ready_with_cached_keys";
    if (time < this.#failedUntil) return "unavailable";
    try {
      await this.#refresh(time);
      return "ready";
    } catch {
      return "unavailable";
    }
  }

  public readReadinessSnapshot(): Readonly<{
    cachedKeyCount: number;
    cacheExpiresAt: Date | null;
    lastSuccessfulRefreshAt: Date | null;
  }> {
    return Object.freeze({
      cachedKeyCount: this.#cachedKeys?.size ?? 0,
      cacheExpiresAt:
        this.#cachedKeys === undefined ? null : new Date(this.#cacheExpiresAt),
      lastSuccessfulRefreshAt:
        this.#lastSuccessfulRefreshAt === 0
          ? null
          : new Date(this.#lastSuccessfulRefreshAt),
    });
  }

  #getCachedKey(kid: string, time: number): CryptoKey | undefined {
    if (this.#cachedKeys === undefined || time >= this.#cacheExpiresAt)
      return undefined;
    return this.#cachedKeys.get(kid);
  }

  async #refresh(time: number): Promise<void> {
    if (this.#inFlightRefresh !== undefined) return this.#inFlightRefresh;
    const refresh = this.#loadKeys(time);
    this.#inFlightRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (this.#inFlightRefresh === refresh) this.#inFlightRefresh = undefined;
    }
  }

  async #loadKeys(time: number): Promise<void> {
    try {
      const response = await this.#requestKeys();
      if (response.status !== 200)
        throw new CloudflareAccessJwksUnavailableError();
      const body = await readBoundedResponse(response);
      const keys = await parseJwks(body);
      this.#cachedKeys = keys;
      this.#cacheExpiresAt = time + CACHE_LIFETIME_MS;
      this.#lastSuccessfulRefreshAt = time;
      this.#failedUntil = 0;
    } catch (error) {
      this.#failedUntil = time + FAILURE_COOLDOWN_MS;
      if (
        error instanceof CloudflareAccessJwksInvalidError ||
        error instanceof CloudflareAccessJwksUnavailableError
      )
        throw error;
      throw new CloudflareAccessJwksUnavailableError();
    }
  }

  async #requestKeys(): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.#fetch(`${this.#configuration.issuer}${JWKS_PATH}`, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch {
      throw new CloudflareAccessJwksUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > MAX_RESPONSE_BYTES
  )
    throw new CloudflareAccessJwksInvalidError();
  if (contentLength !== null && !/^\d+$/u.test(contentLength))
    throw new CloudflareAccessJwksInvalidError();

  const reader = response.body?.getReader();
  if (reader === undefined || reader === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES)
      throw new CloudflareAccessJwksInvalidError();
    return decodeUtf8(bytes);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES)
        throw new CloudflareAccessJwksInvalidError();
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeUtf8(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CloudflareAccessJwksInvalidError();
  }
}

async function parseJwks(body: string): Promise<CachedKeys> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new CloudflareAccessJwksInvalidError();
  }
  if (!isRecord(parsed) || Reflect.ownKeys(parsed).length !== 1)
    throw new CloudflareAccessJwksInvalidError();
  const keys = parsed["keys"];
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_KEYS)
    throw new CloudflareAccessJwksInvalidError();

  const imported = new Map<string, CryptoKey>();
  for (const key of keys) {
    const jwk = validateRsaJwk(key);
    if (imported.has(jwk.kid)) throw new CloudflareAccessJwksInvalidError();
    try {
      imported.set(jwk.kid, await importJWK(jwk, "RS256"));
    } catch {
      throw new CloudflareAccessJwksInvalidError();
    }
  }
  return new Map(imported);
}

function validateRsaJwk(
  input: unknown,
): JWK & { kid: string; kty: "RSA"; n: string; e: string } {
  if (!isRecord(input)) throw new CloudflareAccessJwksInvalidError();
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || !ALLOWED_KEY_FIELDS.has(key),
    )
  )
    throw new CloudflareAccessJwksInvalidError();
  const { alg, e, kid, key_ops, kty, n, use } = input;
  if (
    kty !== "RSA" ||
    typeof kid !== "string" ||
    kid.length < 1 ||
    kid.length > MAX_KID_LENGTH ||
    !KID_PATTERN.test(kid) ||
    typeof n !== "string" ||
    !BASE64URL_PATTERN.test(n) ||
    typeof e !== "string" ||
    !BASE64URL_PATTERN.test(e) ||
    alg !== "RS256" ||
    (use !== undefined && use !== "sig") ||
    (key_ops !== undefined &&
      (!Array.isArray(key_ops) ||
        key_ops.length !== 1 ||
        key_ops[0] !== "verify"))
  )
    throw new CloudflareAccessJwksInvalidError();
  return { ...input, kty, kid, n, e };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
