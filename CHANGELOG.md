# Changelog

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
