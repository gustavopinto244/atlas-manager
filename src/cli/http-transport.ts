import { AtlasCliError } from "./errors.js";
import type { AtlasCliTransport } from "./contracts.js";

export interface AtlasHttpTransportOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
}

export function createAtlasHttpTransport(
  options: AtlasHttpTransportOptions = {},
): AtlasCliTransport {
  const baseUrl = parseBaseUrl(options.baseUrl ?? process.env.ATLAS_BASE_URL);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  return Object.freeze({
    execute: (command: string, args: readonly string[], signal: AbortSignal) =>
      executeHttpCommand(baseUrl, fetchImplementation, command, args, signal),
  });
}

async function executeHttpCommand(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  command: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<unknown> {
  switch (command) {
    case "health":
      return readHealth(baseUrl, fetchImplementation, signal);
    case "status":
      return readStatus(baseUrl, fetchImplementation, signal);
    case "services list":
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        "/admin/services",
        signal,
      );
    case "services status": {
      const serviceId = requireArgument(args, "service id");
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        `/admin/services/${encodeURIComponent(serviceId)}`,
        signal,
      );
    }
    case "services schedule show":
    case "services schedule preview": {
      const serviceId = requireArgument(args, "service id");
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        `/admin/services/${encodeURIComponent(serviceId)}/availability`,
        signal,
      );
    }
    default:
      throw new AtlasCliError(
        "command_not_implemented",
        `Command not implemented yet: ${command}`,
      );
  }
}

async function readHealth(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  const [live, server] = await Promise.all([
    readEndpoint(baseUrl, fetchImplementation, "/health/live", signal),
    readEndpoint(baseUrl, fetchImplementation, "/health/server", signal),
  ]);
  return Object.freeze({ endpoint: endpointLabel(baseUrl), live, server });
}

async function readStatus(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  const health = await readHealth(baseUrl, fetchImplementation, signal);
  let administrative: unknown;
  try {
    administrative = await readEndpoint(
      baseUrl,
      fetchImplementation,
      "/admin/overview",
      signal,
    );
  } catch (error) {
    if (
      error instanceof AtlasCliError &&
      error.code === "administrative_access_denied"
    ) {
      administrative = Object.freeze({ status: "authentication_required" });
    } else {
      throw error;
    }
  }
  return Object.freeze({
    atlasManager: Object.freeze({ endpoint: endpointLabel(baseUrl), health }),
    administrative,
  });
}

async function readEndpoint(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(new URL(path, baseUrl), {
      method: "GET",
      redirect: "error",
      signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AtlasCliError(
      "infrastructure_unavailable",
      "Atlas endpoint unavailable",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new AtlasCliError(
      "administrative_access_denied",
      "Administrative authentication is required",
    );
  }
  if (!response.ok) {
    throw new AtlasCliError(
      "infrastructure_unavailable",
      `Atlas endpoint returned HTTP ${response.status}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new AtlasCliError(
      "infrastructure_unavailable",
      "Atlas returned invalid JSON",
    );
  }
}

function parseBaseUrl(value: string | undefined): URL {
  let baseUrl: URL;
  try {
    baseUrl = new URL(value ?? "http://127.0.0.1:3000");
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

function endpointLabel(baseUrl: URL): string {
  return `${baseUrl.hostname}:${baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80")}`;
}

function requireArgument(args: readonly string[], name: string): string {
  const value = args[0];
  if (value === undefined || value.length === 0) {
    throw new AtlasCliError("invalid_arguments", `${name} is required`);
  }
  return value;
}
