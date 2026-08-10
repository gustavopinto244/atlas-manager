import type { Express, RequestHandler, Response } from "express";
import { readFileSync } from "node:fs";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import { createCloudflareAccessAssertionReader } from "./cloudflare-access-assertion-reader.js";
import type { AdministrativeRequestAdmission } from "./administrative-request-admission.js";
import {
  mapAdministrativeAccessControlError,
  rejectAdministrativeQuery,
  setAdministrativeSecurityHeaders,
  validateAdministrativeRequestHasNoBody,
  validateAdministrativeRequestTarget,
} from "./administrative-http.js";
import { HttpError } from "./errors/http-error.js";
import { registerAdministrativeRoute } from "./administrative-route-security-catalog.js";

export const ADMINISTRATIVE_DASHBOARD_ROUTE = "/";
export const ADMINISTRATIVE_DASHBOARD_ASSET_PREFIX = "/assets/";

export interface ProtectedAdministrativeDashboard {
  readonly getAdministrativeDashboard: Readonly<{
    execute(): Promise<unknown>;
  }>;
}

export interface AdministrativeDashboardRouteDependencies {
  readonly admission: AdministrativeRequestAdmission;
  readonly createProtectedAdministration: (
    reader: CloudflareAccessAssertionReader,
  ) => ProtectedAdministrativeDashboard;
}

const SERVED_ASSETS: Readonly<
  Record<string, Readonly<{ body: string; type: string }>>
> = Object.freeze({
  "app.js": Object.freeze({
    body: readDashboardSource("main.js", "main.ts"),
    type: "application/javascript",
  }),
  "styles.css": Object.freeze({
    body: readDashboardSource("styles.css", "styles.css"),
    type: "text/css",
  }),
});

const HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Manager</title><link rel="stylesheet" href="/assets/styles.css"></head><body><a class="skip-link" href="#dashboard-main">Skip to content</a><div class="dashboard-shell"><header class="dashboard-topbar"><button type="button" class="dashboard-nav-toggle" aria-expanded="false" aria-controls="dashboard-sidebar">Menu</button><p class="dashboard-brand">Atlas Manager</p><p class="dashboard-environment" id="dashboard-environment">Release: unavailable</p><p class="dashboard-health" id="dashboard-health" role="status">Health: unavailable</p><p class="dashboard-last-refresh" id="dashboard-last-refresh">Last refresh: never</p><button type="button" id="dashboard-refresh">Refresh</button></header><div class="dashboard-body"><nav id="dashboard-sidebar" class="dashboard-navigation" aria-label="Administrative sections"></nav><div class="dashboard-scrim"></div><main id="dashboard-main" tabindex="-1"><h1 class="visually-hidden">Atlas Manager administrative console</h1><p id="status" role="status">Loading administrative state…</p><section aria-labelledby="overview-heading"><h2 id="overview-heading">Overview</h2><pre id="app">Loading…</pre></section><section aria-labelledby="services-heading"><h2 id="services-heading">Services</h2><div id="services"></div></section><section aria-labelledby="availability-heading"><h2 id="availability-heading">Schedules</h2><pre id="availability">Loading…</pre></section><section aria-labelledby="safety-heading"><h2 id="safety-heading">Machine</h2><p>Power controls are available only when enabled by the authenticated administrative profile. Physical effects remain governed by the configured backend and safety gates.</p><div id="power-controls"></div></section><section aria-labelledby="backup-heading"><h2 id="backup-heading">Backups</h2><p>Local-only managed backup targets and recent run metadata.</p><div id="backups"></div></section><section aria-labelledby="audit-heading"><h2 id="audit-heading">Events</h2><pre id="audit">Loading…</pre></section></main></div></div><script src="/assets/app.js" defer></script></body></html>\n';

export function getAdministrativeDashboardAssetSnapshot(): Readonly<
  Record<string, Readonly<{ body: string; type: string }>>
> {
  return Object.freeze({
    "index.html": Object.freeze({ body: HTML, type: "text/html" }),
    "app.js": SERVED_ASSETS["app.js"]!,
    "styles.css": SERVED_ASSETS["styles.css"]!,
  });
}

function readDashboardSource(primary: string, fallback: string): string {
  for (const name of [primary, fallback]) {
    try {
      return readFileSync(
        new URL(`../dashboard/${name}`, import.meta.url),
        "utf8",
      );
    } catch {
      // The source tree uses the TypeScript fallback; the build uses JS output.
    }
  }
  throw new Error("dashboard_asset_source_unavailable");
}

export function registerAdministrativeDashboardRoutes(
  app: Express,
  dependencies: AdministrativeDashboardRouteDependencies,
): void {
  registerAdministrativeRoute(
    app,
    ["dashboard.read"],
    createShellHandler(dependencies),
  );
  registerAdministrativeRoute(
    app,
    ["dashboard.asset.read"],
    createAssetHandler(dependencies),
  );
}

function createShellHandler(
  dependencies: AdministrativeDashboardRouteDependencies,
): RequestHandler {
  return createAdmissionHandler(dependencies, async (request, response) => {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    await dependencies
      .createProtectedAdministration(
        createCloudflareAccessAssertionReader(request),
      )
      .getAdministrativeDashboard.execute();
    response.type("html").send(HTML);
  });
}

function createAssetHandler(
  dependencies: AdministrativeDashboardRouteDependencies,
): RequestHandler {
  return createAdmissionHandler(dependencies, async (request, response) => {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      throw new HttpError(405, "method_not_allowed", "Method Not Allowed");
    }
    validateAdministrativeRequestTarget(request.url);
    rejectAdministrativeQuery(request.url);
    validateAdministrativeRequestHasNoBody(request);
    const asset = request.params.asset;
    if (typeof asset !== "string" || !Object.hasOwn(SERVED_ASSETS, asset))
      throw new HttpError(404, "route_not_found", "Route not found");
    await dependencies
      .createProtectedAdministration(
        createCloudflareAccessAssertionReader(request),
      )
      .getAdministrativeDashboard.execute();
    const value = SERVED_ASSETS[asset]!;
    response.type(value.type).send(value.body);
  });
}

function createAdmissionHandler(
  dependencies: AdministrativeDashboardRouteDependencies,
  process: (
    request: Parameters<RequestHandler>[0],
    response: Response,
  ) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    setAdministrativeSecurityHeaders(response);
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const release = dependencies.admission.tryAdmit();
    if (release === undefined) {
      response.setHeader("Retry-After", "1");
      next(
        new HttpError(
          429,
          "administrative_request_limited",
          "Administrative request limit exceeded",
        ),
      );
      return;
    }
    void process(request, response)
      .catch((error) => next(mapError(error)))
      .finally(release);
  };
}

function mapError(error: unknown): HttpError {
  return error instanceof HttpError
    ? error
    : (mapAdministrativeAccessControlError(error) ??
        new HttpError(
          503,
          "administrative_dashboard_unavailable",
          "Administrative dashboard unavailable",
        ));
}
