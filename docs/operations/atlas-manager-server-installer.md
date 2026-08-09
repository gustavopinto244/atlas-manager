# Server installation planner

`atlas-manager-server-installer` is the read-only entrypoint for understanding
the next safe server installation boundary. It is shipped inside the server
bundle and invokes only fixed sibling deployment tools.

## Commands

```sh
./atlas-manager-server-installer inspect
./atlas-manager-server-installer plan
```

`inspect` returns the bounded observations and classified installation state.
`plan` returns the same evidence plus at most one `nextBoundary`. A boundary is
descriptive: the planner never executes it.

Exit status is `0` only when the state is recognized. Exit status `1` still
writes a valid JSON report when the result is `blocked`; preserve that report
as evidence. Invalid arguments and hard execution/report failures fail closed.

## State classifications

| State                         | Meaning                                                             | Possible next boundary                           |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| `preparation_required`        | Clean absent deployment without the managed runtime identity        | Explicit identity preparation                    |
| `disabled_installation_ready` | Host identity and preparation permit disabled installation          | Disabled application install                     |
| `disabled_installation`       | Managed application is installed, disabled and verified             | Explicit runtime-profile selection/configuration |
| `active_mock`                 | Qualified mock lifecycle is active                                  | Explicit deactivation before deployment mutation |
| `removed`                     | Managed application files are absent after removal                  | Disabled application install                     |
| `blocked`                     | Evidence is unsafe, interrupted, unknown or internally inconsistent | None                                             |

The planner does not decide whether to reinstall, upgrade, roll back or
uninstall. Those remain explicit low-level operations, and service activation
remains a separate operator action.

## Security and privilege boundary

The planner:

- accepts no paths, confirmations, credentials or environment overrides;
- invokes no shell and no `sudo`;
- never writes host state;
- limits child output and rejects malformed, mismatched or unexpected reports;
- applies one bounded overall inspection deadline and propagates cancellation;
- treats interrupted and exact-unmanaged identity states as blocked;
- does not expose raw child stderr in its report.

It reports, and never changes, the safe installation baseline:

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
```

Continue with the authoritative low-level command only after reviewing its own
runbook, exact confirmation and rollback contract.
