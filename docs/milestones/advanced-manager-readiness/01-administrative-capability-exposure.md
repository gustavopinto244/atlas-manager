# Administrative capability exposure plan

## Objective

Make every completed administrative capability reachable by an authenticated,
RBAC-authorized operator through the existing architecture:

```text
Browser
  -> Cloudflare Access
  -> Cloudflare Tunnel
  -> Nginx 127.0.0.1:80
  -> Atlas Manager 127.0.0.1:3000
  -> administrative authentication
  -> RBAC
  -> application use case
```

Ports 3000 and 3001 remain loopback-only. This plan does not create anonymous
administration, trusted-Host authentication, assertion bypasses or public
mutation APIs.

## Meaning of exposure states

| State            | Meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| Source-supported | Route/use case exists and is cataloged                                   |
| Configurable     | Required persistence and feature flags have a defined configuration      |
| Enabled          | Deployed runtime reports the feature route as enabled                    |
| Authorized       | The Access principal maps to an Atlas role with the required permission  |
| Accepted         | Browser/API test proves the intended outcome through the production path |
| Partial          | Some required UI, CLI, diagnostics or end-to-end behavior is missing     |

Only **Accepted** is sufficient to say that a capability is open to the
operator. Source inspection alone cannot establish that state.

## Current source inventory

| Capability                                | Source/API                    | Dashboard                   | Target exposure                          | Notes                                                             |
| ----------------------------------------- | ----------------------------- | --------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| Dashboard shell/assets                    | Complete protected routes     | Available                   | Enable and accept                        | Requires `dashboard.read`                                         |
| Overview                                  | Protected API                 | Partial operational cards   | Enable and accept                        | Requires `operations.read`                                        |
| Service list/status/logs                  | Protected API                 | Available                   | Enable and accept                        | PM2/Docker/Compose remain backend adapters                        |
| Service start/stop/restart                | Protected mutations           | Available                   | Enable and accept with confirmation      | RBAC, mutation gate and audit remain mandatory                    |
| Availability override                     | Protected read/write/delete   | Partial                     | Enable if operator workflow requires it  | Temporary override is distinct from base schedule                 |
| Base service schedule                     | Protected read/write/delete   | Weekly editor/timeline      | Enable only with persistent policy store | Requires `SERVICE_AVAILABILITY_POLICY_FILE`                       |
| Schedule preview                          | Protected read                | Timeline                    | Enable and accept                        | Next-transition enrichment remains partial                        |
| Backup targets/runs                       | Protected reads               | Partial                     | Enable and accept                        | Requires valid target and run-store configuration                 |
| Backup run/schedule/retention             | Protected mutations           | Partial forms               | Enable selectively and accept            | Exact confirmation, local-only destinations and audit required    |
| Event history query                       | Protected read                | Available                   | Enable and accept                        | Must preserve bounded queries                                     |
| Event integrity/rotation/retention/export | Protected operations          | Partial                     | Enable and accept per operation          | Requires segmented v2 store and maintenance configuration         |
| Security posture                          | Protected read                | Infrastructure projection   | Enable and accept                        | Must report route reconciliation and identity readiness           |
| Machine plan/schedule                     | Protected overview projection | Read-only                   | Enable read-only                         | Safe with effects disabled                                        |
| Wake alarm HTTP                           | Cataloged power routes        | No complete UI              | Keep disabled in this milestone          | Physical integration requires separate approval and qualification |
| Shutdown HTTP                             | Cataloged power routes        | No complete UI              | Keep disabled in this milestone          | Never use the dashboard as first physical test                    |
| Infrastructure diagnostics                | No complete API               | Partial security projection | Remains partial                          | Nginx, tunnel and listeners need a dedicated read-only boundary   |
| Settings                                  | No complete API               | Placeholder                 | Keep explicitly unavailable              | Do not show a functional control until backend contracts exist    |
| CLI mutations                             | Command tree only             | n/a                         | Keep unavailable                         | Requires an accepted authenticated mutation transport             |

## Intended safe administrative profile

The execution phase should prepare one explicit profile, validated as a whole,
that enables completed non-power surfaces:

```text
ADMINISTRATIVE_DASHBOARD_ENABLED=true
ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=true
ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED=true
ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED=true
ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED=true
ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED=true
ADMINISTRATIVE_BACKUP_HTTP_ENABLED=true
ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED=true
SERVICE_AVAILABILITY_POLICY_FILE=<dedicated persistent path>
```

`ADMINISTRATIVE_SERVICE_SCHEDULE_HTTP_ENABLED` is a derived runtime activation:
it becomes active only when service availability HTTP is enabled and the
persistent policy file is configured.

The following remain invariant during this milestone:

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false
ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false
```

## Configuration and authorization prerequisites

Exposure must fail closed unless all of these are valid:

1. `ADMINISTRATIVE_PUBLIC_ORIGIN` is the production HTTPS admin origin.
2. Cloudflare team name and audience match the Access application.
3. Nginx and Tunnel preserve the real Access assertion header.
4. The authenticated Access principal is present in
   `ADMINISTRATIVE_ROLE_ASSIGNMENTS` with the intended role.
5. Event history persistence exists before any administrative mutation is
   exposed.
6. Schedule, backup and event-maintenance stores use distinct protected paths.
7. The route catalog reconciles exactly with the enabled activation profile.

Cloudflare Access login alone is not authorization to every operation. Atlas
must still map the principal to permissions such as `services.restart`,
`backups.run`, `event_history.retention.write` and `dashboard.read`.

## Execution checks

The future read-only audit should record, without secrets:

- deployed source commit and version;
- effective feature flags and persistence-path presence;
- enabled route count and reconciliation state;
- Access unauthenticated response (`302`, `401` or Access challenge);
- authenticated dashboard response (`200`);
- authenticated principal and effective roles by non-sensitive identifier or
  fingerprint;
- one authorized read per enabled capability group;
- one controlled mutation per mutation group using a test service/target;
- corresponding started/terminal event-history records;
- loopback listeners and absence of public 3000/3001 exposure;
- explicit proof that power effects and power HTTP routes remain disabled.

## Exit criteria

`ADMINISTRATIVE_CAPABILITY_EXPOSURE=PASS` requires every capability marked for
target exposure to be Enabled, Authorized and Accepted. Partial or deliberately
disabled capabilities remain named as such; they are not converted to PASS by
hiding them from the report.
