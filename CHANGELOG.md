# Changelog

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
