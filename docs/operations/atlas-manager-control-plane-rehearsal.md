# Mock-administrative control-plane rehearsal

The control-plane rehearsal is sandbox-only test infrastructure. It uses
synthetic deployment state, deterministic Cloudflare/JWKS observations,
mock service adapters, a sandbox event-history file, fake systemd, and a
closed dashboard asset inventory. It never contacts Cloudflare, Docker,
Compose, PM2, systemd, RTC, D-Bus, or a physical host.

The successful sequence is:

1. install the disabled application;
2. install and verify the mock-administrative profile;
3. activate the service in the fake lifecycle;
4. verify loopback health, the protected dashboard, overview, services,
   availability, and event history;
5. exercise start, restart, stop, availability update, and removal through
   mock capabilities;
6. verify audit ordering and authoritative rereads;
7. confirm wake and shutdown routes remain absent;
8. deactivate the service and verify the disabled deployment remains intact.

Failure scenarios cover authorization denial, malformed confirmations and
policies, mutation conflicts, adapter failures, partial effects, audit
failures, configuration interruption, lifecycle rollback, lock conflicts,
symlink/hard-link attacks, dashboard traversal, and unsafe rendering values.

Evidence is bounded canonical JSON. It records classifications and SHA-256
digests rather than JWTs, role assignments, confirmations, event contents,
paths, command output, or host identifiers. Equivalent runs with different
temporary roots must produce identical evidence bytes.

The rehearsal is not a production command and does not authorize service
activation on the physical Atlas host.
