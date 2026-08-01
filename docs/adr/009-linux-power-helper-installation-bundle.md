# ADR-009 — Distribute the privileged helper as a reproducible local-administrator installation bundle

Status: Accepted

## Decision

Distribute the Linux power helper as a deterministic `linux/amd64` tar.gz
bundle. The bundle contains the exact helper, a separate operator-run Go
installer, a strict manifest, SHA-256 checksums, license texts, and the
installation runbook. Installation is explicit and remains outside npm,
Atlas Manager startup, CI, and the application composition.

The installer accepts only `inspect-bundle`, `install`, `verify`, and
`uninstall`. It discovers the bundle beside its own executable and uses only
the fixed production paths. Mutation requires effective UID zero. The local
`atlas-manager-power` group must already exist and be empty; the installer does
not create it or enroll an application user.

## Rejected alternatives

Debian packaging is rejected because Debian packages must not place files in
the administrator-controlled `/usr/local` hierarchy, while the reviewed
helper identity is fixed at `/usr/local/libexec/atlas-manager-power-helper`.
Changing that path requires a separate security review.

npm lifecycle installation and application self-installation are rejected
because neither Node.js nor Atlas Manager may copy, chown, chmod, setuid,
repair, upgrade, or remove a privileged executable. Remote `curl | sh`, a
container image, a configurable prefix, and automatic network updates are also
rejected.

## Reproducibility and integrity

The package version, source commit, and canonical nonnegative
`SOURCE_DATE_EPOCH` are explicit inputs. Go builds use `CGO_ENABLED=0`,
`GOOS=linux`, `GOARCH=amd64`, `-trimpath`, and `-buildvcs=false`. Archive
ordering, ownership, modes, timestamps, and gzip metadata are normalized.
Checksums protect integrity only; a detached checksum stored beside an archive
does not establish authenticity. Release signing or provenance attestation is
a later gate.

## Installation safety

Before mutation the installer validates the closed manifest, executable hashes,
file types and modes, local group, root-owned safe parents, and any existing
managed installation. Candidates are created in the target directory, synced,
set to exact owner/group/mode `04750`, verified, and atomically renamed into the
fixed path. Installation state is root-owned `0700/0600` and contains no host
or operator identity. A fixed nonblocking lock serializes install, verify, and
uninstall. Unsafe or unknown state fails closed without repair or adoption.

The helper is not setuid inside the archive. Setuid is applied only by the
explicit installer. No CI test writes real `/usr/local`, `/etc/group`, or
`/var/lib`, and no test invokes the helper or real power backend.
