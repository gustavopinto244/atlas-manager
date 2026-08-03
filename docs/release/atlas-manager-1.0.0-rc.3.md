# Atlas Manager 1.0.0-rc.3

`1.0.0-rc.3` supersedes `1.0.0-rc.2` for new qualification. The release
corrects the clean-absent runtime identity password precondition discovered
during the `rc.2` physical-host inspection.

The correction does not weaken account security checks. Residual shadow
entries while the passwd/group identity is absent, missing entries for an
existing identity, duplicate entries, and unlocked passwords remain blocked.
After account creation, verification of exactly one locked password remains
mandatory.

The `rc.2` physical-host evidence remains historical and must not be relabeled
as evidence for this candidate. A new physical-host qualification and
identity-preparation inspection are required using a new commit-bound `rc.3`
bundle. Until that process succeeds, this remains a software release
candidate, not a physically qualified release.

The candidate preserves the mock-only power backend and disabled machine-power
effects. No physical host, real identity database, systemd service, helper,
RTC, D-Bus, or Cloudflare environment is changed by the software validation.
