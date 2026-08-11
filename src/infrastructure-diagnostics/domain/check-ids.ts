/**
 * Check identifiers are a machine contract, never display text (ADR-032 §6).
 *
 * They are namespaced so a presentation adapter can select a coherent subset by
 * prefix — `atlas nginx status` filters `nginx.`, `atlas tunnel status` filters
 * `tunnel.` — without either side needing to enumerate the other's membership.
 * Renaming one is a breaking contract change, not a copy edit.
 */
export const CHECK_ID = Object.freeze({
  atlasService: "atlas.service",
  atlasHealthLive: "atlas.health.live",
  atlasHealthServer: "atlas.health.server",
  pm2Process: "pm2.process",
  listenerAtlas: "listener.atlas",
  schedulerBackup: "scheduler.backup",
  schedulerPower: "scheduler.power",
  schedulerServiceAvailability: "scheduler.service_availability",
  eventHistoryReadiness: "event_history.readiness",
  powerPosture: "power.posture",
  nginxService: "nginx.service",
  nginxConfig: "nginx.config",
  tunnelCloudflaredService: "tunnel.cloudflared.service",
} as const);

export type DiagnosticCheckId = (typeof CHECK_ID)[keyof typeof CHECK_ID];

/**
 * The one authoritative emission order. The orchestrator sorts every result
 * back into this order before returning, so the emitted array never depends on
 * which probe happened to settle first.
 */
export const CHECK_ORDER: readonly DiagnosticCheckId[] = Object.freeze([
  CHECK_ID.atlasService,
  CHECK_ID.atlasHealthLive,
  CHECK_ID.atlasHealthServer,
  CHECK_ID.pm2Process,
  CHECK_ID.listenerAtlas,
  CHECK_ID.schedulerBackup,
  CHECK_ID.schedulerPower,
  CHECK_ID.schedulerServiceAvailability,
  CHECK_ID.eventHistoryReadiness,
  CHECK_ID.powerPosture,
  CHECK_ID.nginxService,
  CHECK_ID.nginxConfig,
  CHECK_ID.tunnelCloudflaredService,
] as const);

/** Prefixes the presentation adapters filter on. */
export const CHECK_ID_PREFIX = Object.freeze({
  listener: "listener.",
  nginx: "nginx.",
  tunnel: "tunnel.",
} as const);
