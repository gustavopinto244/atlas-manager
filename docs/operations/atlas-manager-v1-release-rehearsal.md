# v1 release rehearsal

The software release rehearsal builds and inspects two equivalent bundles,
reconciles the administrative route catalog, exercises browser and identity
failure matrices, replaces and rolls back disabled configuration, exercises
backup and event history, and produces bounded deterministic evidence twice.

The rehearsal uses sandbox paths and synthetic JWKS data. It never contacts
Cloudflare, invokes real systemd, creates accounts, installs the helper, or
requests a machine-power effect.
