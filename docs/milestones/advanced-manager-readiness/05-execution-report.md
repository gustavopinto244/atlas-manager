# Advanced Manager readiness execution report

This report records the four implementation slices that followed the planning
documents. It is source evidence, not proof that a particular Atlas host has
been changed; host deployment remains a separate qualified release operation.

## Slice 1 — safe administrative capability profile

Commit: `e8fdad2`

- kept `authenticationPolicy: required`, Cloudflare Access assertion handling,
  administrative origin validation, RBAC and shared mutation gates;
- exposed effective route IDs and activation flags through the protected
  security posture reader;
- persisted service availability policies at
  `/var/lib/atlas-manager-service-availability/policies.json`;
- added that directory to the hardened systemd state/read-write contract;
- kept power configuration at mock backend, disabled effects, disabled machine
  scheduler, and disabled wake/shutdown HTTP surfaces.

## Slice 2 — operational dashboard

Commit: `d67773c`

- retained the vanilla TypeScript dashboard and its existing protected API
  calls;
- made navigation links and Overview cards usable as deep links;
- restored a valid Overview fallback for unknown hashes and added hash-change
  navigation;
- added application version/source metadata to Overview;
- rendered effective administrative feature flags in Infrastructure;
- preserved explicit confirmation for mutating UI operations.

## Slice 3 — reinstallable operator client

Commit: `9c8aee9`

`npm run package:operator` creates:

- `dist/operator-package/atlas-manager-operator-cli-<version>.tgz`;
- `dist/operator-package/SHA256SUMS`.

The archive contains the complete compiled CLI module tree, has no runtime
dependencies, requires Node 24, and does not contain server state, secrets or
Cloudflare assertions. It installs with `npm install --global` and can be
replaced by installing a newer archive over the old version.

## Deliberate boundaries

The following are not falsely marked open:

- CLI service mutations are still unavailable until an authenticated CLI
  mutation transport is designed and accepted by a dedicated security ADR;
- physical wake/shutdown effects remain disabled and no test performs a real
  power action;
- Settings and host-level infrastructure controls remain server/host-owned
  rather than being invented in dashboard JavaScript.
