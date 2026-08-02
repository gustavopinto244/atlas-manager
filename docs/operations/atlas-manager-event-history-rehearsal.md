# Atlas Manager event-history operational rehearsal

The operational rehearsal is sandbox-only. It uses temporary roots, synthetic
events, injected clocks, and fake process/lock observations. It exercises fresh
v2 persistence, record and segment chains, rotation, migration, cross-process
lock outcomes, stale-lock recovery, retention anchors, pruned queries,
canonical export and protected dashboard delivery.

The rehearsal never reads real event history, creates users, invokes systemd,
contacts Cloudflare, exports externally, installs the helper, accesses RTC or
D-Bus, or causes a machine-power effect. Evidence is bounded and excludes
events, paths, identifiers, tokens, confirmations, temporary directories, and
raw operating-system errors.
