# PR #301 — findings and remediation

This register records findings from the executable-code audit. Severity is
assigned by the review definitions, not by whether an existing test happened
to fail.

## Closed findings

### P1 — enabled power probes did not satisfy request contracts

- **Root cause:** lifecycle verification sent bodyless `PUT`/`POST` requests,
  while the handlers validate media type and body before constructing the
  protected capability.
- **Impact:** correctly enabled mock power surfaces could return `400`/`415`
  instead of the required authentication envelope and block activation with
  `administrative_route_policy_invalid`.
- **Fix:** `5c6119c` makes route-aware probes send canonical future mock occurrences and
  exact stage confirmations without an Access assertion. They reach `401`/`403`
  before every use case and retain loopback as the physical destination.
- **Tests:** the Go transport test now asserts method, body, content type,
  authority and physical destination for every enabled route.

### P1 — wake cancellation catalog advertised a JSON body

- **Root cause:** `power.wake.delete` reused the wake scheduling request policy.
- **Impact:** the catalog and review evidence contradicted the bodyless handler.
- **Fix:** `7c8eae6` changes the descriptor to the zero-byte `NO_BODY` policy.
- **Tests:** the catalog suite pins body `none` and zero maximum bytes.

### P1 — lifecycle hardening removed the legacy profile variant

- **Root cause:** keys previously treated as optional evolution surfaces became
  unconditionally required while the backward-compatibility test was replaced.
- **Impact:** an installed legacy administrative profile could fall through to
  ordinary runtime verification and be rejected as exposing administrative
  routes.
- **Fix:** `5c6119c` accepts current and legacy schemas structurally; optional keys
  must be canonical when present. Any partial/malformed environment carrying
  administrative markers fails closed rather than using the ordinary verifier.
- **Tests:** legacy omission, invalid optional value and partial-profile marker
  coverage in `lifecycle_profile_test.go`.

### P2 — dashboard conflated mutation and refresh failures

- **Root cause:** mutation and post-success refresh shared one `try/catch`.
- **Impact:** a committed mutation could be reported as failed and invite an
  unsafe retry.
- **Fix:** `7c8eae6` distinguishes mutation failure from “saved, refresh failed; recheck”.
- **Tests:** successful mutation with rejected refresh is pinned explicitly.

### P2 — prepared shutdown state survived capability changes

- **Root cause:** the controller retained the prepared occurrence when shutdown
  was disabled, including completion of an older in-flight request.
- **Impact:** re-enabling the surface could display stale preparation state.
- **Fix:** in `7c8eae6`, disabling clears state and a render generation prevents late responses
  from restoring it.
- **Tests:** disable/re-enable and in-flight completion regressions.

### P2 — dashboard accepted non-canonical shutdown responses

- **Root cause:** response timestamps were checked with permissive `Date.parse`.
- **Impact:** the UI could retain an occurrence the execution domain rejects.
- **Fix:** `7c8eae6` requires exact keys and the shared canonical timestamp predicate.
- **Tests:** non-canonical preparation response is rejected without refresh.

### P3 — final health retry waited after its last attempt

- **Root cause:** every retryable failure created a delay, including attempt 20.
- **Impact:** terminal startup failure reporting was delayed by 250 ms.
- **Fix:** in `5c6119c`, the final retryable failure returns without creating another timer.

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
