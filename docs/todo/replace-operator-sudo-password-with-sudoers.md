# TODO: replace the operator sudo password with a scoped /etc/sudoers.d rule

Status: open — not implemented. Recorded from the pre-deploy audit (CRIT-01).

Reference: [pre-deploy audit](../pre-deploy-audit.md), finding CRIT-01.

## Problem

Operator workflows on Atlas currently depend on an interactive `sudo` password,
which was kept in a plaintext file in a working tree. A stored password is
reusable for _any_ command, survives copying, cannot be scoped, cannot be
audited per command, and cannot be revoked without changing the account
credential itself.

Atlas Manager's own architecture already avoids `sudo`: the service runs
unprivileged and reaches privileged operations through the external power
helper (ADR-005), which is admitted by group membership and an exact-digest
runtime identity check rather than by a password.

## Proposed direction

Remove the stored password entirely. Grant the operator account `NOPASSWD` for
an explicit, closed list of commands via a file under `/etc/sudoers.d`,
validated with `visudo -c -f`. No wildcards that admit arbitrary arguments, and
no blanket `ALL` entry.

Anything not on that list should keep requiring an interactive, non-stored
credential.

## Commands to cover

Derived from the process-execution sites in `src/`. All of them run through
`execFile` with `shell: false` and vector arguments, so each has a fixed shape.

### Service lifecycle for Atlas Manager itself

Executed by the operator, not by the application:

```text
/usr/bin/systemctl start atlas-manager.service
/usr/bin/systemctl stop atlas-manager.service
/usr/bin/systemctl restart atlas-manager.service
/usr/bin/systemctl status atlas-manager.service
/usr/bin/systemctl is-enabled atlas-manager.service
/usr/bin/systemctl is-active atlas-manager.service
/usr/bin/journalctl -u atlas-manager.service
```

### Docker adapter

`src/service-management/infrastructure/node-docker-compose-executors.ts`,
`node-docker-container-control-executor.ts`,
`node-docker-container-inspect-executor.ts`,
`node-docker-container-stats-executor.ts`:

```text
docker compose --project-name <name> --project-directory <dir> --file <file> ps --all --format json
docker compose --project-name <name> --project-directory <dir> --file <file> logs --no-color --timestamps --tail <n>
docker container ps|inspect|stats <target>
docker container start <target>
docker container stop --time <seconds> <target>
docker container restart --time <seconds> <target>
docker container logs --timestamps --tail <n> <target>
```

Prefer `docker` group membership for the service account over a sudo rule for
these. A sudo rule that permits `docker` is equivalent to unrestricted root,
because `docker run` can mount the host filesystem. See also the audit finding
LOW-01, which notes the unit currently grants no `docker` group.

### PM2 adapter

`src/service-management/infrastructure/pm2-service-control-executor.ts`,
`pm2-process-list-executor.ts`:

```text
pm2 jlist
pm2 start <processId>
pm2 stop <processId>
pm2 restart <processId>
```

`processId` is validated as a safe integer and the operation is checked against
`SERVICE_CONTROL_OPERATIONS` before execution. PM2 normally runs under the
owning account rather than root; confirm on Atlas whether any sudo rule is
needed at all before adding one.

### Power helper

`src/power-management/infrastructure/node-linux-power-helper-transport.ts`:

```text
/usr/local/libexec/atlas-manager-power-helper
```

Deliberately **not** a sudo candidate. It is invoked with no arguments and takes
one JSON request on stdin, and its privilege comes from the installed helper
identity and group admission, not from `sudo`. Do not add a sudoers entry for
it.

## Acceptance

- No stored password anywhere on the operator workstation or on Atlas.
- `/etc/sudoers.d/atlas-manager-operator` owned `root:root`, mode `440`,
  accepted by `visudo -c -f`.
- Every entry names an absolute path with a fixed argument list.
- No entry grants `docker` through sudo; container access is granted by group
  membership instead.
- Removing the file restores the pre-change behaviour with no other cleanup.

## Open questions

- Which of the systemd operations does the operator actually run unattended, as
  opposed to interactively during a maintenance window?
- Will the PM2 adapter run as the operator account or as a dedicated one? That
  decides whether any PM2 sudo rule exists.
- Should container access be granted at all in the first rollout, given that the
  audit's assumption is a mock-only initial deployment?
