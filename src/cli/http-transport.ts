import { AtlasCliError } from "./errors.js";
import type { AtlasCliTransport } from "./contracts.js";

export interface AtlasHttpTransportOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  /** A real Cloudflare Access JWT held in memory for protected requests. */
  readonly administrativeAccessToken?: string;
}

export function createAtlasHttpTransport(
  options: AtlasHttpTransportOptions = {},
): AtlasCliTransport {
  const baseUrl = parseBaseUrl(options.baseUrl ?? process.env.ATLAS_BASE_URL);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const administrativeAccessToken =
    options.administrativeAccessToken ??
    process.env.ATLAS_CLOUDFLARE_ACCESS_JWT;
  return Object.freeze({
    execute: (command: string, args: readonly string[], signal: AbortSignal) =>
      executeHttpCommand(
        baseUrl,
        fetchImplementation,
        command,
        args,
        signal,
        administrativeAccessToken,
      ),
  });
}

async function executeHttpCommand(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  administrativeAccessToken: string | undefined,
): Promise<unknown> {
  switch (command) {
    case "health":
      return readHealth(
        baseUrl,
        fetchImplementation,
        signal,
        administrativeAccessToken,
      );
    case "status":
      return readStatus(
        baseUrl,
        fetchImplementation,
        signal,
        administrativeAccessToken,
      );
    case "doctor":
      return readDoctor(
        baseUrl,
        fetchImplementation,
        signal,
        administrativeAccessToken,
      );
    case "services list":
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        "/admin/services",
        signal,
        administrativeAccessToken,
      );
    case "services status": {
      const serviceId = requireArgument(args, "service id");
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        `/admin/services/${encodeURIComponent(serviceId)}`,
        signal,
        administrativeAccessToken,
      );
    }
    case "services logs": {
      const serviceId = requireArgument(args, "service id");
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        `/admin/services/${encodeURIComponent(serviceId)}/logs`,
        signal,
        administrativeAccessToken,
      );
    }
    case "services schedule show": {
      const serviceId = requireArgument(args, "service id");
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        `/admin/services/${encodeURIComponent(serviceId)}/schedule`,
        signal,
        administrativeAccessToken,
      );
    }
    case "services schedule preview": {
      const serviceId = requireArgument(args, "service id");
      const interval = readPreviewInterval(args.slice(1));
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        `/admin/services/${encodeURIComponent(serviceId)}/availability/preview?startsAt=${encodeURIComponent(interval.startsAt)}&endsAt=${encodeURIComponent(interval.endsAt)}`,
        signal,
        administrativeAccessToken,
      );
    }
    case "backups list":
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        "/admin/backups/targets",
        signal,
        administrativeAccessToken,
      );
    case "backups status":
      return readOverviewField(
        baseUrl,
        fetchImplementation,
        "backups",
        signal,
        administrativeAccessToken,
      );
    case "backups runs":
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        "/admin/backups/runs?limit=50",
        signal,
        administrativeAccessToken,
      );
    case "events": {
      const limit = args.includes("--tail") ? 100 : 20;
      return readEndpoint(
        baseUrl,
        fetchImplementation,
        `/admin/event-history?limit=${limit}`,
        signal,
        administrativeAccessToken,
      );
    }
    case "machine plan":
      return readOverviewField(
        baseUrl,
        fetchImplementation,
        "machinePlan",
        signal,
        administrativeAccessToken,
      );
    case "machine status":
      return readOverviewField(
        baseUrl,
        fetchImplementation,
        "powerSafety",
        signal,
        administrativeAccessToken,
      );
    case "machine schedule show":
      return readOverviewField(
        baseUrl,
        fetchImplementation,
        "machineSchedule",
        signal,
        administrativeAccessToken,
      );
    default:
      throw new AtlasCliError(
        "command_not_implemented",
        `Command not implemented yet: ${command}`,
      );
  }
}

async function readOverviewField(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  field: "backups" | "machinePlan" | "powerSafety" | "machineSchedule",
  signal: AbortSignal,
  administrativeAccessToken: string | undefined,
): Promise<unknown> {
  const overview = await readEndpoint(
    baseUrl,
    fetchImplementation,
    "/admin/overview",
    signal,
    administrativeAccessToken,
  );
  if (typeof overview !== "object" || overview === null) return null;
  return (overview as Record<string, unknown>)[field] ?? null;
}

function readPreviewInterval(args: readonly string[]): Readonly<{
  startsAt: string;
  endsAt: string;
}> {
  if (args.length === 0) {
    const starts = new Date();
    starts.setUTCSeconds(0, 0);
    return {
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  if (args.length !== 4 || args[0] !== "--from" || args[2] !== "--to")
    throw new AtlasCliError(
      "invalid_arguments",
      "Preview options require --from <timestamp> --to <timestamp>",
    );
  return { startsAt: args[1]!, endsAt: args[3]! };
}

async function readHealth(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  administrativeAccessToken: string | undefined,
): Promise<unknown> {
  const [live, server] = await Promise.all([
    readEndpoint(
      baseUrl,
      fetchImplementation,
      "/health/live",
      signal,
      administrativeAccessToken,
    ),
    readEndpoint(
      baseUrl,
      fetchImplementation,
      "/health/server",
      signal,
      administrativeAccessToken,
    ),
  ]);
  return Object.freeze({ endpoint: endpointLabel(baseUrl), live, server });
}

async function readStatus(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  administrativeAccessToken: string | undefined,
): Promise<unknown> {
  const health = await readHealth(
    baseUrl,
    fetchImplementation,
    signal,
    administrativeAccessToken,
  );
  let administrative: unknown;
  try {
    administrative = await readEndpoint(
      baseUrl,
      fetchImplementation,
      "/admin/overview",
      signal,
      administrativeAccessToken,
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

async function readDoctor(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  administrativeAccessToken: string | undefined,
): Promise<unknown> {
  const checks: Array<Record<string, unknown>> = [];
  for (const [name, path] of [
    ["atlas_health_live", "/health/live"],
    ["atlas_health_server", "/health/server"],
    ["administrative_overview", "/admin/overview"],
    ["administrative_security_posture", "/admin/security/status"],
  ] as const) {
    try {
      await readEndpoint(
        baseUrl,
        fetchImplementation,
        path,
        signal,
        administrativeAccessToken,
      );
      checks.push({ name, status: "pass" });
    } catch (error) {
      checks.push({
        name,
        status: "fail",
        code:
          error instanceof AtlasCliError
            ? error.code
            : "infrastructure_unavailable",
      });
    }
  }
  const failed = checks.filter((check) => check.status === "fail");
  return Object.freeze({
    endpoint: endpointLabel(baseUrl),
    status: failed.length === 0 ? "pass" : "partial",
    checks: Object.freeze(checks),
  });
}

async function readEndpoint(
  baseUrl: URL,
  fetchImplementation: typeof fetch,
  path: string,
  signal: AbortSignal,
  administrativeAccessToken: string | undefined,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(new URL(path, baseUrl), {
      method: "GET",
      redirect: "error",
      signal,
      headers: {
        accept: "application/json",
        ...(administrativeAccessToken === undefined
          ? {}
          : { "Cf-Access-Jwt-Assertion": administrativeAccessToken }),
      },
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
