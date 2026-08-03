# Atlas Manager 1.0.0-rc.2

Status: software-only release candidate; physical qualification pending.

This candidate supersedes `1.0.0-rc.1` after remediation of the release-candidate audit. It includes:

- fail-closed managed backup history and numeric run sequencing;
- repeated event-history retention and export integrity validation;
- route registration through the project-owned administrative security catalog;
- strict administrative host/origin and Fetch Metadata validation;
- identity-readiness reporting with controlled cached-key state;
- controlled disabled administrative configuration replacement and rollback;
- complete production dependency/license inventory and bounded release evidence.

The application remains loopback-bound, stateless with respect to Access
identity, mock-only for machine power, and free of real power effects in this
candidate.

The following remain outside this software qualification: physical Atlas
deployment, real Cloudflare Tunnel/Access ingress, helper installation and
ownership, RTC observation and wake scheduling, systemd-logind shutdown
acceptance, remote backup replication, backup restoration, external audit
attestation, and a general administrative CLI.
