# PR #301 — findings and remediation

This register records findings from the executable-code audit. Severity is
assigned by the review definitions, not by whether an existing test happened
to fail.

## Closed findings

### P1 — unstructured lifecycle profile classification

- **Root cause:** `isAdministrativeProfile` accepted markers with
  `strings.Contains`; duplicate keys and partial/embedded values could affect
  the lifecycle branch selected for runtime verification.
- **Impact:** a malformed environment could be classified inconsistently, and
  `ADMINISTRATIVE_PUBLIC_ORIGIN` could be selected by first-match parsing.
- **Fix:** `0d02937` adds a newline-delimited, duplicate-rejecting environment
  parser, validates the full mock-administrative invariant, and derives the
  Host authority from that parsed record.
- **Tests:** adversarial duplicate, CRLF, prefixed-key, missing-key and invalid
  power-flag cases in `lifecycle_profile_test.go`.

### P1 — administrative verifier ignored enabled power routes

- **Root cause:** `VerifyAdministrative` always required wake/shutdown routes
  to be absent, even when the persisted administrative profile enabled them.
- **Impact:** qualified mock-administrative activation could reject a correct
  enabled power surface, or fail to prove that an enabled route was protected.
- **Fix:** `0d02937` carries the two activation flags through lifecycle
  dependencies; enabled routes must return the expected authenticated/denied
  envelope and disabled routes must be 404.
- **Tests:** enabled route absence is rejected; loopback destination and public
  Host authority are asserted.

### P1 — shutdown persistence path was outside the systemd write sandbox

- **Root cause:** enabled shutdown HTTP configuration emits machine-power
  persistence paths, but the unit omitted their `StateDirectory` and
  `ReadWritePaths` entries.
- **Impact:** the non-root service could fail during mock shutdown preparation
  or execution state persistence.
- **Fix:** `0d02937` declares `atlas-manager-machine-power` with the same
  managed-state permissions as other service stores.
- **Tests:** unit contract test asserts the new path.

### P1 — wake-alarm duplicate JSON keys were accepted

- **Root cause:** wake mutation decoded with `JSON.parse`, unlike the strict
  parser policy advertised by the catalog.
- **Impact:** a repeated `scheduledFor` key had last-value-wins semantics.
- **Fix:** `934b2c3` uses `parseStrictJson` for wake and shutdown request
  bodies; the bespoke shutdown duplicate scanner was removed.
- **Tests:** duplicate wake request is rejected and existing shutdown matrix
  remains green.

### P1 — power route catalog body limits differed from handlers

- **Root cause:** the general catalog mutation helper advertised 8 KiB while
  wake and shutdown handlers enforce 512 B and 1 KiB respectively.
- **Impact:** API contract and generated security evidence were inaccurate.
- **Fix:** `934b2c3` gives those descriptors bounded policies matching their
  handlers.
- **Tests:** catalog test pins both limits.

### P2 — dashboard default wake input used UTC in a local-time control

- **Root cause:** `datetime-local` was populated with an ISO UTC prefix.
- **Impact:** the suggested local time could be shifted by the operator time
  zone before conversion back to canonical UTC.
- **Fix:** `bfd13dc` formats local wall time explicitly; submitted values are
  still converted once by the browser to canonical UTC.

### P2 — machine plan chose past timestamps as “next”

- **Root cause:** transition selection sorted all parseable timestamps without
  reference to `evaluatedAt`.
- **Impact:** the dashboard could present a completed transition as upcoming.
- **Fix:** `bfd13dc` selects the earliest timestamp strictly after
  `evaluatedAt`, and distinguishes invalid evaluation data from a valid empty
  plan.
- **Tests:** past-versus-future selection and unavailable-plan rendering.

## Deferred non-blocking observations

- Legacy static dashboard asset constants remain only as fallback material;
  runtime `app.js`, stylesheet, event-history asset, backup asset, and package
  snapshot are served from their authoritative sources. This is P3 cleanup,
  not a security boundary, and was not refactored during the focused review.
- The administrative verifier proves enabled routes through their authenticated
  error envelope and the runtime/catalog reconciler separately proves that
  routes are registered. It deliberately does not attempt authenticated
  power mutation during a lifecycle probe.

## Safety invariant

All reviewed administrative profiles retain:

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
```

No review test uses a physical power adapter, system power command, or real
RTC write.
