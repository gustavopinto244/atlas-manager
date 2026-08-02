# Issue #283 implementation report

Branch: `feat/event-history-operational-lifecycle-integrity-export`

Authoritative baseline: `fa94db38ade054f72637c238b8f8c63bbea41702`

## Delivered boundary

The implementation adds v2 event-history records, canonical serialization,
record and segment SHA-256 chaining, bounded active segments, sealed manifests,
retention anchors, protected integrity/rotation/retention/export routes, a
cross-process atomic writer lock, maintenance actions, v1 migration support,
and deployment profile fields for the fixed event-history directory.

All new persistence paths are fixed by production composition. Tests inject
temporary sandbox roots and clocks. The v1 source is preserved during
migration. No restore, remote export, arbitrary path, automatic repair,
external signing, physical deployment, helper operation, or power effect is
part of this delivery.

## Evidence and validation

Recorded locally for this implementation:

- Node.js `v24.18.0`, npm `11.16.0`, Go `1.23.0`;
- branch `feat/event-history-operational-lifecycle-integrity-export`;
- baseline `fa94db38ade054f72637c238b8f8c63bbea41702`;
- Node validation: format, lint, typecheck, build, and `2,643` serialized
  tests passed with `3` intentional skips;
- `npm audit --omit=dev`: `0` vulnerabilities;
- deployment Go and power-helper Go format, module verification, vet, and
  test suites passed;
- two identical deployment bundle archives produced SHA-256
  `5781643fdfe8cce71ee0b8f3d305b88d1f11e2c389191dff7636d30a6326c77e`;
- bundle inspection passed and verified the event-history maintenance module,
  dashboard assets, manifest, checksums, and managed state directory;
- dependency diff is empty for `package.json`, `package-lock.json`, both Go
  modules, and both Go sum files;
- `git diff --check` passed.

The event-history evidence builder is deterministic and bounded; its focused
test passes. No generated evidence file is committed. No real administrative
history, external export, production path, Cloudflare request, systemd
operation, account command, helper operation, RTC/D-Bus resource, host, VM,
or power effect was used.
