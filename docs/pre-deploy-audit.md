# Pre-deploy audit — Atlas Manager

- **Audited version:** `1.0.0-rc.11` (`package.json`)
- **Branch:** `fix/cloudflare-access-dashboard-return-navigation` (clean working tree)
- **Deployment target:** Atlas — headless Ubuntu, 4th-generation i3, 8 GB RAM
- **Date:** 2026-08-09
- **Nature:** read-only. No source file was modified; this report is the only
  artifact produced.

Finding identifiers were renamed from the original Portuguese draft to English:
`ALT-*` → `HIGH-*` and `BAI-*` → `LOW-*`, preserving their numbers. `CRIT-*` and
`MED-*` are unchanged. The credential in CRIT-01 is redacted here; the report is
versioned and must not carry the secret itself.

---

## 1. Executive summary

### Baseline checks executed

| Check                  | Command                              | Result                            |
| ---------------------- | ------------------------------------ | --------------------------------- |
| Types                  | `npm run typecheck`                  | Passed, no errors                 |
| Tests                  | `npm test`                           | 214 files, 2753 passed, 3 skipped |
| Lint                   | `npm run lint`                       | Passed, no warnings               |
| Vulnerabilities (prod) | `npm audit --omit=dev`               | 0 vulnerabilities                 |
| Release snapshots      | `npm run release:validate-snapshots` | `{"result":"valid"}`              |

Internal code quality is high and consistent: the domain/application/
infrastructure separation holds, process execution always goes through
`execFile` with `shell: false` and vector arguments, configuration validation
uses Zod with cross-field refinements and a fail-closed posture, Cloudflare
Access JWT verification is rigorous (fixed algorithm, validated `kid`, rejection
of `jku`/`jwk`/`x5u`/`x5c`, canonical base64url, explicit clock tolerance), RBAC
denies by default, and the HTTP security envelope validates `Host`, `Origin` and
`Sec-Fetch-*`.

### Finding count

| Severity  | Count  |
| --------- | ------ |
| Critical  | 1      |
| High      | 3      |
| Medium    | 6      |
| Low       | 4      |
| **Total** | **14** |

### Verdict

**Not ready to deploy as-is — but close.** The blockers are few and well
localized; none of them is architectural.

Mandatory blockers before deploying:

1. **CRIT-01** — plaintext `sudo` password in the working directory. Must be
   rotated and the file removed before any copy reaches the server.
2. **HIGH-01** — the dashboard served by the deploy bundle is broken: the
   JavaScript delivered is an ES module served as a classic script.
3. **HIGH-03** — host qualification demands Node **exactly `v24.18.0`** at
   `/usr/bin/node`; if Atlas does not have that exact version at that path, the
   installation is blocked.

The remaining High and Medium findings do not prevent deployment, but
**HIGH-02** (backup memory consumption) should be resolved or worked around
through configuration before registering any backup target containing large
files, given the machine's 8 GB RAM limit.

### Categories with no findings

- **Shell injection:** none. Every process-execution site (`docker`,
  `docker compose`, `pm2`, power helper) uses `execFile` with `shell: false` and
  vector arguments, with operation allowlists, `timeout` and `maxBuffer`.
  `src/service-management/infrastructure/node-docker-compose-executors.ts`,
  `pm2-service-control-executor.ts`, `node-linux-power-helper-transport.ts:88`.
- **SQL string concatenation:** not applicable. The project uses **no database**;
  persistence is JSON/JSONL files with atomic writes (`open` + `write` +
  `rename`) and `fsync` in the event history.
- **Unauthenticated administrative routes:** none. All 45 catalog routes carry
  `authenticationPolicy: "required"`, and
  `reconcileAdministrativeRouteRegistrations` (`src/http/create-app.ts:171`)
  fails at startup if registered routes diverge from the catalog.
- **Permissive CORS:** none. There is no CORS middleware; the envelope rejects
  any `Origin` other than the configured public origin.
- **Hardcoded secrets in source:** none in `src/`. The only secret found lives in
  an environment file (CRIT-01).

---

## 2. Findings table

| ID      | Sev.     | File:line                                                                                     | Description                                                                                        | Status      |
| ------- | -------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------- |
| CRIT-01 | Critical | `.env.operator:1-2`                                                                           | Real `sudo` password in plaintext inside the project directory                                     | [CONFIRMED] |
| HIGH-01 | High     | `deployment/internal/bundle/builder.go:134` + `src/http/administrative-dashboard-route.ts:61` | Deploy bundle serves an ES module as a classic script; dashboard JS never loads                    | [CONFIRMED] |
| HIGH-02 | High     | `src/backup-management/infrastructure/filesystem-tree-backup-adapter.ts:237`                  | Backup manifest loads each file wholly into RAM; limit permits 20 GiB per file                     | [CONFIRMED] |
| HIGH-03 | High     | `deployment/internal/hostinspection/inspection.go:476`                                        | Qualification demands Node exactly `v24.18.0` at `/usr/bin/node`; undocumented                     | [CONFIRMED] |
| MED-01  | Medium   | `src/main.ts:276`, `src/http/create-administrative-runtime.ts:363`                            | Application version hardcoded to `"1.0.0-rc.8"` while the package is `1.0.0-rc.11`                 | [CONFIRMED] |
| MED-02  | Low      | `src/http/administrative-route-security-catalog.ts:54,307`                                    | Derived activation named like an environment variable that does not exist (see correction below)   | [CONFIRMED] |
| MED-03  | Medium   | `.env.example`                                                                                | 6 variables read by the code are absent from `.env.example`                                        | [CONFIRMED] |
| MED-04  | Medium   | `src/config/environment.ts:455-473`                                                           | `ADMINISTRATIVE_DASHBOARD_ENABLED` does not require the APIs the dashboard consumes                | [CONFIRMED] |
| MED-05  | Medium   | `src/http/create-app.ts:121-134,211-214`                                                      | `/health/*` sits outside the security envelope and is unauthenticated; no Nginx config in the repo | [CONFIRMED] |
| MED-06  | Medium   | `deployment/internal/systemdunit/unit.go:18` + `src/main.ts`                                  | `Restart=no` with no `unhandledRejection` handler: one rejection downs the service permanently     | [CONFIRMED] |
| LOW-01  | Low      | `deployment/internal/systemdunit/unit.go:12-13`                                               | Unit grants no `docker` group and sets no `PATH`; Docker/PM2 adapters may fail                     | [SUSPECTED] |
| LOW-02  | Low      | `src/power-management/infrastructure/node-linux-power-helper-transport.ts:212-218`            | `safelyKill` sends only `SIGTERM`, with no escalation to `SIGKILL`                                 | [CONFIRMED] |
| LOW-03  | Low      | `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:397,1157`    | Synchronous history writes block the event loop on the request path                                | [CONFIRMED] |
| LOW-04  | Low      | repository root                                                                               | Stray working-tree artifacts: `yay-bin/`, `.agents/`, `.codex/`, `atlas-manager-dist/`             | [CONFIRMED] |

---

## 3. Finding details

### CRIT-01 — Plaintext `sudo` password in the project directory · [CONFIRMED]

**File:** `.env.operator:1-2`

**Evidence:**

```
ADMIN_PRINCIPAL_ID = "caf45cc3-4312-5d41-8603-cc0102346a1f"
SUDO_PASSWORD = "<redacted in this report>"
```

**Verifications performed:**

- `git ls-files | grep -i env` → the file is **not** tracked. `.gitignore` covers
  `.env.*` with an exception only for `.env.example`.
- `git log --all -- .env.operator` → no commits. Nothing leaked into Git history.
- Search for `SUDO_PASSWORD` and `ADMIN_PRINCIPAL_ID` across `src/`, `scripts/`,
  `deployment/`, `power-helper/`, `docs/` and `*.json` files → **no references**.
  Nothing in the project reads this file.

**Why it is critical despite being outside Git:** it is a real privilege-
escalation credential, in plaintext, inside a directory that will be packaged or
copied to the server. Any `rsync`/`scp`/`tar` of the project directory, any
`$HOME` backup, or any tool reading the working directory exposes it. The format
is also invalid for a systemd `EnvironmentFile` (spaces around `=`, quoted
values), reinforcing that it is manual leftover.

**Described remediation (not applied):** rotate the `sudo` password of the
affected account; remove `.env.operator`; if `ADMIN_PRINCIPAL_ID` really is the
production administrative principal, move it into
`/etc/atlas-manager/atlas-manager.env` via `ADMINISTRATIVE_ROLE_ASSIGNMENTS`. The
product architecture needs no `sudo` password anywhere — the privileged path is
the external helper (`ADR-005`), not `sudo`.

---

### HIGH-01 — Dashboard broken in the deploy bundle · [CONFIRMED]

**Files:** `deployment/internal/bundle/builder.go:134-137`,
`src/http/administrative-dashboard-route.ts:61,74,96-108`

**Evidence chain:**

1. `src/dashboard/main.ts:1-12` carries 5 `import` statements for sibling modules
   (`./navigation.js`, `./power-controls.js`, `./machine-plan-view.js`,
   `./schedule-view.js`, `./weekly-schedule-editor.js`).
2. `package.json` → `"build": "tsc -p tsconfig.build.json && node --import tsx/esm scripts/generate-dashboard-assets.mjs"`.
   The second step runs `esbuild --bundle --format=iife` and **overwrites**
   `dist/dashboard/main.js` with an import-free IIFE, even asserting
   `if (/^\s*(?:import|export)\s/mu.test(compiledApp)) throw new Error("dashboard_app_not_bundled")`
   (`scripts/generate-dashboard-assets.mjs`).
3. The deploy bundle builder runs **only** `tsc`:
   ```go
   // deployment/internal/bundle/builder.go:134
   config.Runner.Run(ctx, "node", []string{"node_modules/typescript/bin/tsc", "-p", "tsconfig.deployment.json"}, buildRoot, environment)
   ```
   There is no `esbuild` or `scripts/generate-dashboard-assets.mjs` invocation in
   `builder.go` (verified with `grep -n "esbuild\|dashboard" builder.go`).
4. At runtime the served asset comes from
   `readDashboardSource("main.js", "main.ts")`
   (`administrative-dashboard-route.ts:61`), resolving
   `new URL("../dashboard/main.js", import.meta.url)` — that is,
   `application/dist/dashboard/main.js`, the raw `tsc` output.
5. The HTML shell loads that asset as a **classic script**:
   `<script src="/assets/app.js" defer></script>`
   (`administrative-dashboard-route.ts:74`). A classic script containing `import`
   is a `SyntaxError` — the whole dashboard stalls at
   "Loading administrative state…".

**Why the CI check misses it:** `scripts/verify-dashboard-assets.mjs` compares
`dist/dashboard-assets/*` against `<bundle>/dashboard/*` — a reference copy that
lives **outside** `application/dist/` and is not what the process serves at
runtime. The file actually delivered to the browser is never verified.

**Current local `dist/` state:** contains the correct IIFE
(`"use strict"; (() => {`), because it was produced by `npm run build`. This
confirms the esbuild step exists and works — it simply is not part of the deploy
bundle path.

**Described remediation:** include the dashboard bundling step in `builder.go`
(after `tsc`, before assembling `application/dist`), and extend
`verify-dashboard-assets.mjs` to check `application/dist/dashboard/main.js` with
the same `dashboard_app_not_bundled` rule.

---

### HIGH-02 — Backup loads whole files into RAM · [CONFIRMED]

**File:** `src/backup-management/infrastructure/filesystem-tree-backup-adapter.ts:231-246`

**Evidence:**

```ts
const dataHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
let data: Buffer;
try {
  data = await dataHandle.readFile();   // <- entire file in memory
} finally {
  await dataHandle.close();
}
files.push({ ..., sha256: createHash("sha256").update(data).digest("hex") });
```

**What makes this avoidable:** the copy in `#copyTree` (lines 174-190) **already
computes** the SHA-256 in streaming fashion with a 64 KiB buffer
(`const hash = createHash("sha256")` … `hash.update(...)`), then **discards** the
result (line 206 uses the digest only as a sanity check via
`hash.digest("hex").length !== 64`). `#readCopiedFiles` then re-reads everything
into memory to recompute the same hash.

**Configurable limits** (`src/backup-management/domain/backup-target.ts:27-30`):

```
BACKUP_MAX_FILES       = 100_000
BACKUP_MAX_TOTAL_BYTES = 100 GiB
BACKUP_MAX_FILE_BYTES  =  20 GiB
```

A backup target may legitimately declare `maxFileBytes` up to 20 GiB. On an 8 GB
machine, any source file above a few GB kills the process
(`ERR_FS_FILE_TOO_LARGE` or the OOM killer). Because `Restart=no` (MED-06), the
service does not come back on its own.

**Described remediation:** propagate the digest already computed in `#copyTree`
into `#readCopiedFiles` (or build the manifest directly inside `#copyTree`),
eliminating the re-read. As an immediate mitigation without touching code, keep
registered targets' `maxFileBytes` well below available RAM (suggestion:
≤ 512 MiB).

---

### HIGH-03 — Node pinned to exact `v24.18.0`, undocumented · [CONFIRMED]

**File:** `deployment/internal/hostinspection/inspection.go:467-480`

**Evidence:**

```go
if err := command.Run(); err != nil || stdout.overflow || stderr.overflow ||
   strings.TrimSpace(string(stdout.data)) != "v24.18.0" {
    return fmt.Errorf("node_runtime_version_mismatch")
}
```

The inspected binary is `inspector.paths.Deployment.Node`, and the systemd unit
uses `ExecStart=/usr/bin/node /opt/atlas-manager/current/dist/main.js`
(`deployment/internal/systemdunit/unit.go:17`).

**Documentation divergence:** `.nvmrc` says `24`; `package.json` says
`"engines": { "node": ">=24 <25" }`; `docs/installation.md` and
`docs/operations/atlas-manager-deployment-host-qualification.md` mention no
version at all. The only other occurrence of `24.18.0` in the repository is
`.github/workflows/ci.yml:160`. In other words, the real deployment requirement —
Node **exactly** `v24.18.0` at `/usr/bin/node` — appears in no installation
document.

**Context confirmation:** this development machine has no `/usr/bin/node`; it
uses nvm with `v24.18.0` and `v24.18.1` installed. An nvm-based installation on
Atlas satisfies **neither** the systemd unit nor qualification.

**Described remediation:** document the exact requirement in
`docs/installation.md`; consider relaxing the comparison to the `>=24 <25` range
declared in `engines`, since a Node 24.x security patch today blocks
qualification until the Go code changes.

---

### MED-01 — Stale application version in the API · [CONFIRMED]

**Files:** `src/main.ts:276`, `src/http/create-administrative-runtime.ts:363`

```ts
applicationVersion: "1.0.0-rc.8",                            // main.ts:276
compositionDependencies.applicationVersion ?? "1.0.0-rc.8",  // :363
```

`package.json` is at `1.0.0-rc.11`. The value is exposed at `/admin/overview`
(`administrative-overview-route.ts:90` → `application: { version: ... }`) and
rendered in the dashboard (`src/dashboard/main.ts:88`, "Version: …"). The
operator sees `rc.8` on an `rc.11` system.

Note that the CLI does this correctly: `src/cli/main.ts:13-24` reads the version
from `package.json` at runtime and validates its format. The API should use the
same source.

---

### MED-02 — Contract activation flag does not exist as a variable · [CONFIRMED]

**Files:** `src/http/administrative-route-security-catalog.ts:54,307,339,348`,
`src/http/create-app.ts:196-197`, `src/http/create-administrative-runtime.ts:340-351`

The route security catalog — the declared source of the public contract
(`docs/contracts/atlas-manager-administrative-api.json` → `"source":
"src/http/administrative-route-security-catalog.ts"`) — declares
`ADMINISTRATIVE_SERVICE_SCHEDULE_HTTP_ENABLED` as the activation flag for the
three `services.schedule.*` routes.

That variable **does not exist** in the environment schema
(`src/config/environment.ts:219-334`) and does not appear in `.env.example`.
Actual activation is derived:

```ts
// create-administrative-runtime.ts:340
...((config.administrativeServiceAvailabilityHttpEnabled ?? false) &&
    config.serviceAvailabilityPolicyFilePath !== undefined ? { schedule: ... } : {})
```

Practical consequence: if `ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED=true`
but `SERVICE_AVAILABILITY_POLICY_FILE` is unset, the dashboard's weekly editor
(`src/dashboard/weekly-schedule-editor.ts`, which calls
`/admin/services/:id/schedule`) receives 404 with no startup configuration
signal. The operator has no way to enable that flag by its documented name.

**Correction, recorded while remediating.** This finding was overstated. The
derived activation is intentional and was already documented in
`docs/milestones/advanced-manager-readiness/01-administrative-capability-exposure.md`,
and the runtime emits the flag exactly when it registers the routes, so the
system is internally consistent. Two remediation attempts failed against that
consistency: moving the routes under the availability flag breaks the default
availability-without-policy-file configuration, because
`reconcileAdministrativeRouteRegistrations` requires the active flag set to
determine the registered route set exactly. The real defect is only the name:
an `_HTTP_ENABLED` suffix on something that is not an environment variable. It
was renamed to `ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY`; severity in
hindsight is Low, not Medium.

---

### MED-03 — Environment variables missing from `.env.example` · [CONFIRMED]

Difference measured between keys read by the code and keys present in
`.env.example`:

| Variable                                                    | Where it is used                    |
| ----------------------------------------------------------- | ----------------------------------- |
| `MACHINE_POWER_EFFECTS_CONFIRMATION`                        | `src/config/environment.ts:256,507` |
| `LINUX_POWER_HELPER_EXPECTED_SHA256`                        | `src/config/environment.ts:257,515` |
| `SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE` | `src/config/environment.ts:259`     |
| `SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE` | `src/config/environment.ts:261`     |
| `SERVICE_AVAILABILITY_OVERRIDE_FILE`                        | `src/config/environment.ts:263`     |
| `SERVICE_AVAILABILITY_POLICY_FILE`                          | `src/config/environment.ts:264`     |

The first two are **mandatory** when
`MACHINE_POWER_EFFECTS_ACTIVATION=linux_helper`
(`src/config/environment.ts:505-525`) — that is, at exactly the mock-to-real
power transition, the operator needs two variables no example mentions. The
fourth and sixth are prerequisites for MED-02.

Reverse direction: no variable in `.env.example` is ignored by the code. All 7
that appear only in the example (`HOST`, `PORT`, `LOG_LEVEL`,
`POWER_MANAGEMENT_BACKEND`, `MACHINE_OPERATING_POLICY`,
`MACHINE_POWER_SCHEDULER_ENABLED`,
`ADMINISTRATIVE_EVENT_HISTORY_AUTOMATIC_RETENTION_ENABLED`) were checked
individually and exist in the schema — they merely do not appear as string
literals in a textual search.

---

### MED-04 — Dashboard can be enabled without the APIs it consumes · [CONFIRMED]

**File:** `src/config/environment.ts:440-473`, `540-620`

`superRefine` validates many combinations strictly (requiring
`CLOUDFLARE_ACCESS_*`, `ADMINISTRATIVE_PUBLIC_ORIGIN`, history persistence,
`ADMINISTRATIVE_ROLE_ASSIGNMENTS`, and requiring `EVENT_HISTORY_HTTP` whenever
`EVENT_HISTORY_OPERATIONS_HTTP` is on). But `dashboardEnabled` participates only
in the `administrativeHttpEnabled` disjunction (line 471) — nothing requires the
APIs the dashboard actually calls.

`src/dashboard/main.ts` consumes `/admin/overview`, `/admin/services`,
`/admin/services/:id/logs`, `/admin/services/:id/availability`,
`/admin/services/:id/availability/preview`, `/admin/services/:id/schedule`,
`/admin/backups/targets`, `/admin/backups/runs` and `/admin/event-history`.

With `ADMINISTRATIVE_DASHBOARD_ENABLED=true` and the other flags `false`, the
service starts without error, the dashboard loads, and every call returns 404,
yielding "Administrative overview unavailable." The dependency is also
undocumented: `docs/operations/atlas-manager-operator-dashboard.md:5` mentions
only `ADMINISTRATIVE_DASHBOARD_ENABLED=true`.

---

### MED-05 — `/health/*` outside the security envelope; Nginx unspecified · [CONFIRMED]

**File:** `src/http/create-app.ts:121-134` and `211-214`

The administrative envelope applies to three prefixes only:

```ts
if (
  request.path === "/" ||
  request.path.startsWith("/assets/") ||
  request.path.startsWith("/admin")
)
  return envelope(request, response, next);
next();
```

`/health/live` and `/health/server` fall outside: no `Host` validation, no
`Origin` validation, no `Sec-Fetch-*`, no security headers, and **no
authentication**. `/health/server` returns a full host portrait
(`src/server-health/domain/server-health-snapshot.ts`): total/free/used memory,
CPU usage and temperature, three load averages, and disk usage.

This is acceptable while the process is bound to `127.0.0.1` (the schema forces
`HOST=127.0.0.1` whenever administration is enabled —
`src/config/environment.ts:541-546`), but the README describes the chain
`Cloudflare Access → Cloudflare Tunnel → Nginx loopback → Atlas Manager`, and
**no Nginx configuration exists in the repository** (a search for `*.conf`
returned zero files; `grep -rl nginx deployment/ docs/operations/` returned
zero). The component that decides whether `/health/server` is exposed to the
Internet is neither versioned nor documented.

**Described remediation:** version the Nginx configuration (or document it under
`docs/operations/`), guaranteeing at minimum: `location /health/` restricted to
loopback or denied; `proxy_set_header Host` with the canonical administrative
host; explicit removal of inbound `Cf-Access-*` headers that do not originate
from the tunnel.

---

### MED-06 — `Restart=no` with no safety net for unhandled rejections · [CONFIRMED]

**Files:** `deployment/internal/systemdunit/unit.go:18`, `src/main.ts`

`grep -rn "unhandledRejection\|uncaughtException\|process.on(" src` returns
**zero results**. The only signal registration is
`registerShutdownSignals(process, requestShutdown)` for `SIGINT`/`SIGTERM`
(`src/lifecycle/graceful-shutdown.ts:79-88`).

Node 24 defaults to `--unhandled-rejections=throw`: a single promise rejected
outside a `try/catch` terminates the process. Combined with `Restart=no`, the
service stays permanently down on a headless machine until manual intervention.

This is a **deliberate, documented decision** (`ADR-021`,
`docs/security-model.md:1255`,
`docs/operations/atlas-manager-disabled-installation.md:45`), not an accidental
defect — the unit even explicitly forbids `NoNewPrivileges=true`,
`RestrictSUIDSGID=true` and `PrivateDevices=true` (`unit.go:60`), showing the
unit content is intentionally controlled. Recorded here for a conscious
decision: with `Restart=no`, consider an `unhandledRejection` handler that logs
and shuts down cleanly, or an external alert (`OnFailure=`) so the outage is
noticed.

---

### LOW-01 — `docker` group and `PATH` not provisioned in the unit · [SUSPECTED]

**File:** `deployment/internal/systemdunit/unit.go:12-13,17`

The unit runs as `User=atlas-manager` with `SupplementaryGroups=atlas-manager-power`
only. Adapters invoke `"docker"` and `"pm2"` by name, resolved through systemd's
default `PATH` (the unit sets no `Environment=PATH=`).

- Docker: without membership in the `docker` group, `docker ...` fails with
  permission denied on `/var/run/docker.sock`.
- PM2: typical installations live under nvm/`$HOME`, outside
  `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`.

No document under `docs/` addresses group membership for these adapters
(`grep -rl docker docs/*.md docs/operations/*.md` → only `glossary.md` and
`architecture.md`, with no installation instructions).

**What is missing to confirm:** whether services with `managementAdapter`
`docker`/`compose`/`pm2` will be registered in this deployment. If every
registered service is `mock`, the finding is inert. Marked [SUSPECTED] for that
reason.

---

### LOW-02 — Power helper lacks `SIGKILL` escalation · [CONFIRMED]

**File:** `src/power-management/infrastructure/node-linux-power-helper-transport.ts:212-218`

```ts
function safelyKill(child: ChildProcess): void {
  try {
    if (!child.killed) child.kill("SIGTERM");
  } catch {}
}
```

On the `helper_timeout` path (line 197) the child receives only `SIGTERM`. A
wedged helper ignoring `SIGTERM` is orphaned. Impact is limited:
`KillMode=control-group` in the systemd unit reaps children on service shutdown,
and executions are serialized through `#tail` (lines 34, 53-60), preventing
concurrent accumulation.

---

### LOW-03 — Synchronous history writes on the request path · [CONFIRMED]

**File:** `src/event-history/infrastructure/file-segmented-administrative-event-history.ts:397,1157,1167`

The event history uses `appendFileSync`, `writeFileSync`, `renameSync` and
`fsyncSync`. The choice is coherent with the integrity goal (durability
guaranteed before responding), but it blocks the event loop on every audited
administrative mutation. For the usage profile — single operator, 4th-generation
i3 — this is acceptable; recorded for awareness, not as a defect.

---

### LOW-04 — Stray working-tree artifacts · [CONFIRMED]

- `yay-bin/` — an AUR clone with ~10 MB of `.pkg.tar.zst`, unrelated to the
  project (gitignored, but present in the directory).
- `.agents/`, `.codex/`, `atlas-manager-dist/deployment/` — empty directories.
- `dist/` holds accumulated rehearsal subdirectories
  (`atlas-manager-bundle-candidate-a`, `-b`, `-merged`, `-merged-repeat`,
  `-repeat`, `advanced-manager-qualification-a0424cf`).

No functional impact; relevant only if deployment is performed by copying the
working directory instead of the bundle — which is also the risk vector behind
CRIT-01.

---

## 4. Documentation gaps

1. **Nginx configuration absent.** The README describes Nginx as a mandatory link
   in the access chain, but no configuration file exists in the repository and no
   document under `docs/operations/` describes it. Reference: MED-05.
2. **Exact Node version undocumented.** The real requirement (exactly `v24.18.0`
   at `/usr/bin/node`) exists only in `inspection.go:476` and `ci.yml:160`.
   `docs/installation.md` mentions no version. Reference: HIGH-03.
3. **Service adapter prerequisites undocumented.** No document describes what the
   host needs for the `docker`, `compose` and `pm2` adapters (binaries, groups,
   `PATH`). Reference: LOW-01.
4. **Dashboard flag coupling undocumented.**
   `docs/operations/atlas-manager-operator-dashboard.md` mentions only
   `ADMINISTRATIVE_DASHBOARD_ENABLED=true`, without listing the APIs that must be
   enabled alongside it. Reference: MED-04.
5. **`.env.example` incomplete.** Reference: MED-03. In particular, the two
   variables required to activate Linux power effects
   (`MACHINE_POWER_EFFECTS_CONFIRMATION`, `LINUX_POWER_HELPER_EXPECTED_SHA256`)
   appear in no configuration example.
6. **`docs/cli.md` does not cover the `infra` subcommand.** `command-tree.ts`
   defines `infra nginx`, `infra tunnel`, `infra listeners` and `infra test`; the
   document's "Available read-only commands" section omits them. Several commands
   are also marked `implemented: false` in code without the document
   distinguishing which ones already respond.
7. **Validation scripts are not runnable standalone.** `npm run release:validate`
   fails with `ENOENT` on `atlas-manager-release-contract.json` (an artifact
   generated earlier in the pipeline) and `npm run dashboard:verify-assets` fails
   with `dashboard_arguments_invalid` (it requires three arguments). Both work
   only with CI context. Not a defect, but no document says so — a trap for
   anyone trying to validate the release locally before deploying.

---

## 5. Questions for the maintainer

1. **`.env.operator`** — where did this file come from, and has the `sudo`
   password in it been used on a real host? The assumption is that it is manual
   test leftover and that the password belongs to the Atlas account or this
   workstation. If it is a production credential, rotation is urgent and
   independent of the deployment.

2. **`ADMIN_PRINCIPAL_ID`** — is the UUID in `.env.operator` (`caf45cc3-…`) the
   real Cloudflare Access administrative principal? If so, it must move into
   `ADMINISTRATIVE_ROLE_ASSIGNMENTS` with the `administrator` role; the assumption
   is yes, but it was not found in any versioned configuration file.

3. **Service adapters in the initial deployment** — will services with
   `managementAdapter` `docker`/`compose`/`pm2` be registered in this rollout, or
   only `mock`? The assumption is a mock-only first rollout (as `.env.example` and
   ADRs 021/022 suggest); this determines whether LOW-01 is blocking.

4. **Backups** — which Atlas directories are intended as `filesystem_tree`
   targets, and what is the largest individual file expected in them? The
   assumption is that no target is registered yet. With 8 GB RAM, HIGH-02 becomes
   blocking as soon as a target contains gigabyte-scale files.

5. **Node on Atlas** — is Node already installed on the machine, and at which
   version and path? The assumption is that it is not, and that installation will
   follow the `/usr/bin/node` = exactly `v24.18.0` requirement. If the machine
   already has Node via nvm or apt, host qualification will block.

6. **Nginx and `/health/*`** — does the Atlas Nginx configuration already exist
   outside this repository? The assumption is yes, and that it does not expose
   `/health/server` publicly. If it is still to be written, it is worth versioning
   it here.

7. **Power effects** — the first rollout goes out with
   `MACHINE_POWER_EFFECTS_ACTIVATION=disabled` (mock), correct? The assumption is
   yes. The whole MED-03 analysis presumes `linux_helper` activation arrives in a
   later stage, when the two undocumented variables become mandatory.

8. **Release contract** — resolved. The `catalogSha256` field named in this
   finding had no generator or verifier anywhere in the repository (confirmed
   by exhaustive grep across `scripts/`, `deployment/`, and `tests/`); the
   actual integrity mechanism for this file is a whole-file SHA256 digest
   computed by `scripts/generate-release-contract.mjs` and
   `scripts/generate-release-evidence.mjs` and checked by
   `scripts/validate-release-artifacts.mjs` against
   `contract.administrativeApiContractSha256` / `evidence.routeCatalog.contractSha256`
   in the separate release-contract/evidence files — a real, tested mechanism
   independent of any field inside this file. The orphaned `catalogSha256`
   field was removed rather than populated with a value nothing would ever
   check.
