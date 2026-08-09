# Changelog

## 1.0.0-rc.8

- assigns a new immutable release identity to the Advanced Manager readiness
  source after the Atlas host was already running a different `1.0.0-rc.7`
  generation;
- prevents deployment procedures from overwriting the managed
  `/opt/atlas-manager/releases/1.0.0-rc.7` directory or weakening the
  installer rollback contract;
- requires fresh commit-bound candidates, reproducibility evidence, host
  preflight, and side-by-side upgrade qualification before deployment.

## 1.0.0-rc.7

- canonicalizes bundle directories and regular files to `0755` or `0644`,
  making manifests, checksums, and archives independent of the builder's
  `umask`; commit-bound rc.7 bundles built before this correction are
  superseded and must not be used for physical qualification;
- corrects the false-positive runtime identity preparation block when the
  supported shadow 4.17.4 build omits the `lastlog` backend and the trusted
  preexisting `lastlog` contains records;
- classifies `lastlog` build capability from the shared `ENABLE_LASTLOG`
  contract governing the advertised `--no-log-init` option and
  `lastlog_reset` implementation;
- retains fail-closed handling for non-empty `faillog`, executable
  `pam_tally2`, unsafe paths, and changed immutable login-log baselines;
- supersedes rc.6 and requires a new commit-bound bundle plus complete
  physical Atlas requalification before merge, tag, or release.

## 1.0.0-rc.6

- accepts the proven trusted Ubuntu login-log layout without permitting
  arbitrary group-writable paths;
- supports canonical merged-usr `/sbin -> /usr/sbin` resolution while
  rejecting unsafe ownership, permissions, types, and symlink targets;
- captures immutable path-layout and external-artifact baselines and preserves
  `recovery_required` behavior when they change;
- records rc.5 as historically blocked for physical identity preparation and
  requires complete physical requalification for this candidate.

## 1.0.0-rc.5

- corrects clean-absent runtime identity password-state handling;
- hardens real `useradd` capability probing and removes unsupported hardcoded
  `--no-log-init` assumptions;
- accepts `GROUPS=`, expanded canonical defaults, and compatible
  `USRSKEL`/`LOG_INIT` output while requiring exactly one
  `CREATE_MAIL_SPOOL=no`;
- classifies login-log backends and verifies immutable external baselines;
- hardens rollback ownership boundaries and recovery-required reporting;
- adds Ubuntu 26.04 source-level fixture coverage;
- keeps rc.2, rc.3, and rc.4 historical blockers intact; physical
  requalification and a new commit-bound bundle remain required.

## 1.0.0-rc.4

- resets the software release candidate after the two runtime-identity
  corrections delivered after `rc.2` and `rc.3`;
- probes fixed `useradd` capabilities before mutation and conditionally uses
  `--no-log-init`;
- validates effective `CREATE_MAIL_SPOOL=no` without the invalid `--key`
  override;
- preserves original failure stages and verifies complete rollback residue;
- remains software-only and unqualified pending a new commit-bound bundle and
  physical qualification.

## 1.0.0-rc.3

- supersedes `1.0.0-rc.2` after correcting the clean-absent runtime identity
  password precondition exposed by physical-host inspection;
- accepts zero shadow entries only while the complete runtime identity is
  absent, while retaining blocking checks for residual, missing, duplicate,
  and unlocked shadow states;
- retains mandatory post-creation verification of one locked runtime password;
- requires a new commit-bound deployment bundle and physical qualification;
- keeps the `rc.2` physical-host evidence historical and software-only.

## 1.0.0-rc.2

- supersedes `1.0.0-rc.1` after audit remediation;
- hardens managed directory metadata, backup reconstruction, sequencing, and retention;
- binds administrative route registration to the closed security catalog;
- hardens administrative authority parsing and identity-readiness reporting;
- qualifies configuration generation replacement and rollback boundaries;
- records software-only release evidence; physical qualification remains pending.

## 1.0.0-rc.1

- completed v0.9 administrative route inventory and security envelope;
- added identity readiness and disabled configuration replacement/rollback;
- superseded by `1.0.0-rc.2` because its evidence was not reproducible;
- kept physical deployment, helper activation, and real power effects separate.
