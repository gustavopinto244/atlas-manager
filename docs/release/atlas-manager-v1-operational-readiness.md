# Historical Atlas Manager v1 operational-readiness snapshot — 1.0.0-rc.8

> **HISTORICAL SNAPSHOT.** This document preserves the lifecycle boundary at
> `1.0.0-rc.8`. It is not the current GA acceptance record. See
> [Atlas Manager 1.0.0 final operational acceptance evidence](atlas-manager-1.0.0-final-operational-acceptance-evidence.md)
> and the
> [post-GA reconciliation review](../reviews/final-1.0.0-reconciliation-and-power-hardening.md).

The `1.0.0-rc.8` software candidate documents the lifecycle for install,
verify, managed mock-administrative configuration, disabled replacement,
disabled rollback, activation, active verification, deactivation, upgrade,
release rollback, backup recovery, event-history recovery, identity-readiness
recovery, and bounded uninstall.

Replacement and rollback require an inactive and disabled service, fixed input,
exact confirmation, an administrator assignment, real Go and TypeScript
validation, atomic candidates, generation evidence, and a clean transaction.
They never start or restart the service.

Broken history, interrupted transactions, stale locks, invalid identity
configuration, modified generations, and unsafe managed state fail closed and
require operator review.

At this historical point, the final stable-release decision remained separate
from physical Atlas deployment, real Cloudflare ingress, helper ownership, RTC
wake behavior, and systemd-logind shutdown acceptance. GA later recorded real
Atlas and Cloudflare acceptance; physical RTC/wake/shutdown qualification is
still a separate, open gate.
