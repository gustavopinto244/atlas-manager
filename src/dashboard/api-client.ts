// Typed administrative API client.
//
// Every read resolves to a normalized outcome instead of rejecting, so a caller
// can render one failing section without losing the others. Malformed payloads
// are reported as invalid_response and never silently degraded into an empty
// authoritative state: "no registered services" and "the service list could not
// be read" must remain distinguishable in the interface.

export type AdministrativeFailureOutcome =
  | "unauthorized"
  | "forbidden"
  | "busy"
  | "unavailable"
  | "invalid_response"
  | "network_error";

export type AdministrativeReadResult =
  | Readonly<{ outcome: "success"; value: unknown }>
  | Readonly<{ outcome: AdministrativeFailureOutcome }>;

export type AdministrativeResponseValidator = (value: unknown) => boolean;

export interface AdministrativeFetch {
  (path: string, init: RequestInit): Promise<Response>;
}

export interface AdministrativeApiClientDependencies {
  readonly fetch: AdministrativeFetch;
}

const FAILURE_DESCRIPTIONS: Readonly<
  Record<AdministrativeFailureOutcome, string>
> = Object.freeze({
  unauthorized: "Administrative authentication is required.",
  forbidden: "This administrative operation is not permitted for you.",
  busy: "The administrative interface is busy. Retry shortly.",
  unavailable: "This administrative capability is unavailable.",
  invalid_response: "The response could not be interpreted.",
  network_error: "The administrative interface could not be reached.",
});

export function describeAdministrativeFailure(
  outcome: AdministrativeFailureOutcome,
): string {
  return FAILURE_DESCRIPTIONS[outcome];
}

export class AdministrativeApiClient {
  readonly #fetch: AdministrativeFetch;

  public constructor(dependencies: AdministrativeApiClientDependencies) {
    this.#fetch = dependencies.fetch;
    Object.freeze(this);
  }

  public async read(
    path: string,
    validate?: AdministrativeResponseValidator,
  ): Promise<AdministrativeReadResult> {
    let response: Response;
    try {
      response = await this.#fetch(path, {
        credentials: "same-origin",
        redirect: "error",
      });
    } catch {
      return Object.freeze({ outcome: "network_error" as const });
    }
    if (!response.ok)
      return Object.freeze({ outcome: outcomeForStatus(response.status) });
    let value: unknown;
    try {
      value = (await response.json()) as unknown;
    } catch {
      return Object.freeze({ outcome: "invalid_response" as const });
    }
    if (validate !== undefined && !validate(value))
      return Object.freeze({ outcome: "invalid_response" as const });
    return Object.freeze({ outcome: "success" as const, value });
  }
}

function outcomeForStatus(status: number): AdministrativeFailureOutcome {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 409 || status === 429) return "busy";
  return "unavailable";
}

// Shape guards. These accept the documented response envelope only; anything
// else is invalid_response rather than an empty rendering.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasRecordArray(key: string): AdministrativeResponseValidator {
  return (value) =>
    isRecord(value) &&
    Array.isArray(value[key]) &&
    (value[key] as readonly unknown[]).every((entry) => isRecord(entry));
}
