# Atlas Manager v1 operational readiness

The `1.0.0-rc.3` software candidate documents the lifecycle for install,
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

The final stable-release decision remains separate from physical Atlas
deployment, real Cloudflare ingress, helper ownership, RTC wake behavior, and
systemd-logind shutdown acceptance.
