import type { CloudflareAccessJwksFetch } from "./cloudflare-access-jwks-provider.js";

export type FakeCloudflareAccessJwksResponse = Readonly<{
  status?: number;
  body?: string | Uint8Array;
  headers?: Readonly<Record<string, string>>;
}>;

export class FakeCloudflareAccessJwksFetch {
  readonly #responses: readonly FakeCloudflareAccessJwksResponse[];
  readonly #error: Error | undefined;
  readonly calls!: readonly Readonly<{
    url: string;
    init: Readonly<Record<string, unknown>>;
  }>[];
  #mutableCalls: {
    url: string;
    init: Readonly<Record<string, unknown>>;
  }[] = [];
  #responseIndex = 0;

  public constructor(input: {
    readonly responses?: readonly FakeCloudflareAccessJwksResponse[];
    readonly error?: Error;
  }) {
    this.#responses = Object.freeze([...(input.responses ?? [])]);
    this.#error = input.error;
    Object.defineProperty(this, "calls", {
      configurable: false,
      enumerable: true,
      get: () => Object.freeze([...this.#mutableCalls]),
    });
    Object.freeze(this);
  }

  public readonly fetch: CloudflareAccessJwksFetch = (url, init) => {
    this.#mutableCalls.push({ url, init });
    if (this.#error !== undefined) throw this.#error;
    const response =
      this.#responses[this.#responseIndex] ??
      this.#responses[this.#responses.length - 1];
    this.#responseIndex += 1;
    if (response === undefined) throw new Error("Fake response unavailable");
    return Promise.resolve(
      new Response((response.body as BodyInit) ?? "", {
        status: response.status ?? 200,
        ...(response.headers === undefined
          ? {}
          : { headers: response.headers }),
      }),
    );
  };
}
