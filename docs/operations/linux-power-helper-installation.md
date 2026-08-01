# Linux power-helper installation runbook

This runbook describes the operator-controlled installation boundary for the
Atlas Manager Linux power helper. It does not install anything automatically.

## Supported bundle

Issue #254 produces only `linux/amd64` bundles with `CGO_ENABLED=0`. The
package version and `SOURCE_DATE_EPOCH` are explicit build inputs. A detached
SHA-256 file verifies integrity, but a checksum stored beside an artifact does
not prove authenticity; retain the reviewed source commit and use a separately
reviewed signature or provenance attestation when that gate is available.

The archive contains one directory with the helper, installer, manifest,
checksums, licenses, and this documentation. It does not contain the fixture,
source tree, secrets, or Node.js dependencies.

## Prerequisite group

The local group must already exist and must be empty:

```bash
sudo groupadd --system atlas-manager-power
```

The installer never creates the group and never enrolls an application user.
Do not add the Atlas Manager user in this Issue. Enrollment belongs to a later
host-activation review.

## Inspect and verify

Run the installer from the unpacked bundle directory:

```bash
./bin/atlas-manager-power-helper-installer inspect-bundle
./bin/atlas-manager-power-helper-installer verify
```

The installer discovers its bundle from its own executable location. It does
not accept a destination, root, bundle, or binary path.

## Installation and upgrade

After reviewing the manifest, source commit, checksum, host qualification, and
empty group, an operator may run:

```bash
sudo ./bin/atlas-manager-power-helper-installer install
sudo ./bin/atlas-manager-power-helper-installer verify
```

The fixed installed state is root-owned, group `atlas-manager-power`, mode
`04750`, at `/usr/local/libexec/atlas-manager-power-helper`. Installation
validates the complete bundle before an atomic replacement. It does not restart
Atlas Manager, enroll users, run the helper, or activate application wiring.

An upgrade uses the same command and path. The previous valid bundle must be
retained by the operator for explicit rollback.

## Recovery and rollback

If installation fails before replacement, the managed candidate is removed and
the existing helper remains unchanged. If replacement succeeds but state
recording is interrupted, a later invocation reconciles only an exact helper
hash and exact metadata; an unknown mismatch fails closed for manual inspection.
There are no hidden backups, network downloads, retries, or automatic
rollback. Rollback means explicitly installing a previously retained and
verified bundle.

## Removal

```bash
sudo ./bin/atlas-manager-power-helper-installer uninstall
```

Removal requires a matching managed state record and removes only the fixed
helper and its state directory. It preserves `/usr/local/libexec`, the
`atlas-manager-power` group, all users, and unrelated files.

## Remaining activation gates

This bundle does not certify a distribution, kernel, RTC, firmware wake
behavior, or systemd-logind host. It does not enable Atlas Manager production
wiring or HTTP effects. Host qualification, installation recovery drills,
application-user enrollment, and production activation require later reviewed
Issues.
