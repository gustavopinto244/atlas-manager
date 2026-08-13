# ADR-016 — Admit Linux power effects only for the dedicated Atlas Manager runtime identity

Status: Accepted

ADR-035 narrows the current mock/default service profile: the helper-group
membership below is required only when Linux power effects are explicitly
admitted. Mock lifecycle verification now rejects that unused authority.

## Decision

Linux power-effects admission is valid only when the running process is the
fixed dedicated service identity:

```text
user       → atlas-manager
group      → atlas-manager
home       → /var/lib/atlas-manager
shell      → /usr/sbin/nologin
helper     → atlas-manager-power
```

The target host allocates numeric IDs, but startup must resolve them
unambiguously from the fixed local `/etc/passwd` and `/etc/group` files. The
real and effective UID and GID must be positive, equal, and non-root. The
runtime account fields must match the fixed contract, the process must belong
to the resolved helper-group GID, and the helper file must be owned by that
same exact GID.

The identity inspector is Linux-only, read-only, bounded, and constructed
with fixed production paths. It validates `/etc`, account-file metadata,
bounded UTF-8 contents, canonical numeric IDs, duplicate relevant names and
IDs, primary-group consistency, helper-group consistency, and supplementary
membership. It never creates or changes accounts, groups, memberships, home
directories, shells, UID/GID state, or privileges.

The admitted identity is an immutable internal startup fact. Numeric IDs are
not exposed through HTTP or normal logs. The same admitted helper-group GID is
passed to the startup hash preflight and the operation-time helper transport.
If the installed helper changes to another group, the next operation fails
closed; no arbitrary positive group is accepted and no fallback to mock exists.

## Independent gates

The following decisions remain separate:

```text
application runtime identity
local account database identity
helper-group identity and process membership
helper installation ownership and permissions
startup power-effects activation
application-user and group enrollment
systemd service configuration
host qualification
real-effect certification
```

This delivery completes only the exact runtime identity definition, startup
identity admission, and helper-group GID binding. It does not create the
`atlas-manager` account or either group, install a systemd unit, install the
helper, enroll a user, deploy Atlas, qualify the physical host, or certify a
real power effect.

The identity is not an administrative principal. It is not mapped to
Cloudflare Access, an administrative UUID, a role, a human audit actor, or a
scheduler actor. HTTP authentication, authorization, request confirmation,
scheduler policy confirmation, readiness, and preparation remain unchanged.

## Alternatives rejected

Environment-selected usernames, UIDs, GIDs, homes, shells, account database
paths, NSS commands, `getent`, `id`, `groups`, shell execution, user switching,
privilege switching, account repair, group repair, textual helper-group member
matching, and acceptance of any non-root helper group were rejected. Numeric
IDs remain host-assigned, but names and relationships are fixed by this
reviewed application contract.

## Scope and safety

Disabled, mock, and inert Linux configurations do not inspect account files or
require the dedicated account. Identity inspection occurs only for admitted
Linux effects and precedes helper hashing, power composition, HTTP creation,
and scheduler startup. Development and CI use injected account data and
temporary project-owned fakes. No account, group, helper, host, VM, RTC,
D-Bus, wake, reboot, shutdown, ownership, permission, or setuid state was
changed.
