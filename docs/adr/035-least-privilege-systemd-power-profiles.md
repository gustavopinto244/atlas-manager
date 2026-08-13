# ADR-035 — Separate the least-privilege mock systemd profile from future power authority

Status: Accepted

Date: 2026-08-13

## Context

The `1.0.0` deployment bundle originally shipped one systemd unit that was
prepared for a future setuid power helper. It supplied
`SupplementaryGroups=atlas-manager-power` and deliberately omitted
`NoNewPrivileges=true` and `RestrictSUIDSGID=true`, because those settings
would prevent the helper from gaining its reviewed effective identity.

That contract was safe only in combination with the independent ADR-015
activation gates, but it gave the default mock process authority it did not
use. The GA default is mock-only, effects-disabled, and scheduler-disabled.
Least privilege therefore requires the installed unit to match that default
rather than a hypothetical future activation.

## Decision

Atlas Manager has two explicit systemd profiles.

### Mock/default profile

`systemd/atlas-manager.service` is the only unit selected by
`atlas-manager-installer install-disabled`. It:

- runs as `atlas-manager:atlas-manager` without any supplementary power group;
- sets `NoNewPrivileges=true` and `RestrictSUIDSGID=true`;
- retains the existing private state/runtime directories, filesystem
  restrictions, address-family restriction, loopback application
  configuration boundary, and `Restart=no` policy;
- is the only profile accepted by the default bundle/install/lifecycle path.

Runtime verification for this profile still requires the exact dedicated
service account, primary group, home, shell, and non-root identity. It now
rejects a running process that unexpectedly has the `atlas-manager-power`
group. The helper group may exist in the account database for forward
compatibility, but the mock service receives no membership in it.

### Future power-enabled profile

The immutable bundle inventories a separate
`systemd/profiles/atlas-manager-power-enabled.service` template. It adds only
the fixed `atlas-manager-power` supplementary group and omits the two
setuid-incompatible hardenings above. It does not add capabilities, invoke the
helper, select a backend, set an activation variable, enable a route, or start
a scheduler.

No current installer or lifecycle action selects this template. A future
physical activation procedure must explicitly select it through a separately
reviewed operator boundary. Merely installing the helper, placing a file at
its fixed path, or including this template in a bundle cannot change the
installed unit.

The intended invariant is:

```text
default installation -> mock unit -> no physical-power authority
explicit future profile selection -> helper execution group only
                               + every independent ADR-015 gate
```

## Power gate preservation

Neither profile may define or override:

```text
POWER_MANAGEMENT_BACKEND
MACHINE_POWER_EFFECTS_ACTIVATION
MACHINE_POWER_EFFECTS_CONFIRMATION
LINUX_POWER_HELPER_EXPECTED_SHA256
MACHINE_POWER_SCHEDULER_ENABLED
ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED
ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED
```

Both use the same root-managed `EnvironmentFile`. The systemd profile is an OS
privilege decision only; it is never evidence that backend selection,
effect-capable surface activation, hash-bound admission, authentication,
authorization, confirmation, readiness, host qualification, or physical
certification succeeded. Startup preflight remains fail-closed with no helper
discovery, configurable helper path, implicit sudo, HTTP activation, or mock
fallback.

## Compatibility and validation

Managed upgrade inspection accepts the exact historical power-ready units only
as predecessors so the new bundle can replace them. New bundle inspection and
mock lifecycle activation require the hardened default unit. The bundle also
validates and checksums the separate power-enabled template, while the
installer always copies only the default unit to
`/etc/systemd/system/atlas-manager.service`.

Go tests prove profile separation, explicit selection, default installation,
predecessor compatibility, gate non-override, and mock runtime rejection of
the helper group. CI inspects both bundle artifacts and confirms the installed
default contract remains power-free.

## Consequences

Service management, backups, diagnostics, dashboard, CLI, and administrative
HTTP continue to use the ordinary unprivileged Node runtime and do not require
setuid transitions. Full Node and Go validation protects their compatibility
with `NoNewPrivileges` and `RestrictSUIDSGID`.

Physical power remains unactivated. This ADR does not install or execute the
helper, change host accounts or groups, run systemd, access RTC or D-Bus,
schedule a wake alarm, or request shutdown, reboot, suspend, or hibernation.
