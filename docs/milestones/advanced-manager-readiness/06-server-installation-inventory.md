# Server installation orchestration inventory

## Scope

This inventory binds Phase 4 to the executable deployment contracts already in
the bundle. It does not authorize host mutation or deployment. The proposed
orchestrator is a presentation/application adapter over these tools; each
existing package remains authoritative for validation, locking, persistence,
rollback and confirmations.

## Existing stages

| Stage                        | Executable                                           | Read-only actions                                                              | Mutation actions                                                               | Persistence owner                        | Stop boundary                                                                                   |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Bundle integrity             | `atlas-manager-installer`                            | `inspect-bundle`, `verify-disabled`                                            | `install-disabled`, `rollback-disabled`, `uninstall-disabled`                  | deployment installer                     | active/enabled service, unsafe identity/state, lock or modified managed files                   |
| Host readiness               | `atlas-manager-host-qualification`                   | `qualify`, `verify-prepared`, `verify-disabled-installation`, `verify-removed` | none                                                                           | none                                     | any blocked platform, filesystem, identity, deployment, configuration or runtime check          |
| Runtime identity             | `atlas-manager-runtime-identity-installer`           | `inspect`, `verify-managed`                                                    | `prepare-disabled`                                                             | identity preparation transaction         | partial identity, unsafe account database, login-log ambiguity, deployment residue or lock      |
| Runtime configuration        | `atlas-manager-runtime-configuration`                | `inspect`, `verify-mock`                                                       | `install-mock`, `remove-mock`                                                  | mock runtime configuration transaction   | enabled service, unsafe state, modified configuration or lock                                   |
| Administrative configuration | `atlas-manager-administrative-runtime-configuration` | `inspect`, `validate-input`, `verify-installed`                                | `install-disabled`, `replace-disabled`, `rollback-disabled`, `remove-disabled` | administrative configuration transaction | invalid input/state, enabled service, identity/deployment mismatch or lock                      |
| Service lifecycle            | `atlas-manager-service-lifecycle`                    | `inspect`, `verify-active-mock`, `verify-inactive`                             | `activate-mock`, `deactivate`                                                  | lifecycle transaction and systemd        | invalid deployment/configuration/unit, residue, systemd mismatch or failed runtime verification |

The runtime configuration and administrative configuration executables are two
profile implementations of one configuration stage. The wrapper must not run
both mutation paths for one installation.

## Contracts to preserve

- Fixed Linux `amd64` production paths remain defined by the existing tools.
- Bundle inspection remains non-mutating and closed over `MANIFEST.json` and
  `SHA256SUMS`.
- Read-only reports may exit nonzero when their result is `blocked`; the JSON
  report remains evidence and must not be discarded.
- Hard tool failure, missing/malformed/oversized output or an unexpected action
  fails the orchestration closed.
- No shell is used and no confirmation, principal, password, assertion or
  environment content is accepted by `inspect` or `plan`.
- Activation stays a separate explicit operation after disabled installation
  and configuration.
- Configuration, state, event history, backups and scheduler stores remain
  preserved by default during application uninstall.

## Phase 4 target

The first server experience binary is `atlas-manager-server-installer` with
only:

```text
atlas-manager-server-installer inspect
atlas-manager-server-installer plan
```

Both actions execute the same fixed read-only probe inventory. `inspect`
reports the observed tool outcomes. `plan` additionally classifies the
installation state and lists the next explicit boundary without invoking it.

Mutation sequencing is deliberately deferred until a later slice proves that
the planner classifies absent, same-version, upgrade, rollback, uninstall,
interrupted and unknown states correctly.

## Safety invariant

The planner never changes the power profile. Any future mutation orchestration
must continue to preserve:

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
```
