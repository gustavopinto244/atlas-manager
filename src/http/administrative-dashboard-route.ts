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

/*
 * The dashboard shell (Design v3).
 *
 * Assembled from parts for readability and served as one string. Three
 * structural contracts are load-bearing and must survive any edit here:
 *
 *   - every page container stays a *direct* child of <main>, because
 *     `navigation.ts` shows and hides them via `main > section`;
 *   - each section keeps `aria-labelledby` pointing at its own <h2> id, which
 *     is the key `navigation.ts` matches pages against;
 *   - every element id consumed by `src/dashboard/*.ts` keeps its id.
 *
 * The nav-toggle glyph is an inline <svg> rather than an icon font or a
 * `data:` image because the route's CSP sets `font-src 'none'` and
 * `img-src 'self'`.
 */
const NAV_TOGGLE_ICON =
  '<svg class="nav-toggle-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>' +
  "</svg>";

const HEAD =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="color-scheme" content="dark">' +
  "<title>Atlas Manager</title>" +
  '<link rel="stylesheet" href="/assets/styles.css"></head>';

const TOPBAR =
  '<header class="dashboard-topbar">' +
  '<button type="button" class="dashboard-nav-toggle" aria-expanded="false" aria-controls="dashboard-sidebar">' +
  NAV_TOGGLE_ICON +
  '<span class="visually-hidden">Toggle navigation</span></button>' +
  '<p class="dashboard-brand">Atlas Manager</p>' +
  '<div class="dashboard-meta">' +
  '<p class="dashboard-environment" id="dashboard-environment">Release: unavailable</p>' +
  '<p class="dashboard-health" id="dashboard-health" role="status">Health: unavailable</p>' +
  '<p class="dashboard-last-refresh" id="dashboard-last-refresh">Last refresh: never</p>' +
  '<button type="button" id="dashboard-refresh">Refresh</button>' +
  "</div></header>";

const SECTIONS =
  '<section aria-labelledby="overview-heading"><h2 id="overview-heading">Overview</h2>' +
  "<p>Live administrative state for this Atlas host: release identity, resource pressure, and the safety posture governing machine power.</p>" +
  '<pre id="app">Loading…</pre></section>' +
  '<section aria-labelledby="services-heading"><h2 id="services-heading">Services</h2>' +
  "<p>Registered services and their observed state. Every control here is bounded by the operations each service actually declares as supported.</p>" +
  '<div id="services"></div></section>' +
  '<section aria-labelledby="availability-heading"><h2 id="availability-heading">Schedules</h2>' +
  "<p>Declared availability policy per service, the reconciliation cursor, and any active override with its expiry.</p>" +
  '<pre id="availability">Loading…</pre></section>' +
  '<section aria-labelledby="safety-heading"><h2 id="safety-heading">Machine</h2>' +
  "<p>Power controls are available only when enabled by the authenticated administrative profile. Physical effects remain governed by the configured backend and safety gates.</p>" +
  '<div id="power-controls"></div></section>' +
  '<section aria-labelledby="backup-heading"><h2 id="backup-heading">Backups</h2>' +
  "<p>Local-only managed backup targets and recent run metadata.</p>" +
  '<div id="backups"></div></section>' +
  '<section aria-labelledby="audit-heading"><h2 id="audit-heading">Events</h2>' +
  "<p>The administrative event history: an append-only, hash-chained record of every authorization decision and mutation.</p>" +
  '<pre id="audit">Loading…</pre></section>';

const HTML =
  HEAD +
  '<body><a class="skip-link" href="#dashboard-main">Skip to content</a>' +
  '<div class="dashboard-shell">' +
  TOPBAR +
  '<div class="dashboard-body">' +
  '<nav id="dashboard-sidebar" class="dashboard-navigation" aria-label="Administrative sections"></nav>' +
  '<div class="dashboard-scrim"></div>' +
  '<main id="dashboard-main" tabindex="-1">' +
  '<h1 class="visually-hidden">Atlas Manager administrative console</h1>' +
  '<p id="status" role="status">Loading administrative state…</p>' +
  SECTIONS +
  "</main></div></div>" +
  '<script src="/assets/app.js" defer></script></body></html>\n';

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
