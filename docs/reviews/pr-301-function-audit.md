# PR #301 — function audit

## Scope and method

This audit contains one explicit section for every changed function, method and
constructor inventoried for PR #301, including private Go and TypeScript
helpers. Line numbers bind to the current review HEAD. Contracts were traced
through validation, protected use cases, persistence/audit and output; tests are
supporting evidence rather than the source of truth.

### `ExampleInputBytes`

File: `deployment/internal/administrativeconfiguration/input.go`

Lines: 27

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate administrative input and generate the canonical mock-administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated input, authority, or canonical environment bytes; errors are fail-closed.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Environment generation only; no persistence or external effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Defines public-origin authority and immutable mock-only power invariants.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/administrativeconfiguration Go suite and TypeScript profile-equivalence tests.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `ValidateInput`

File: `deployment/internal/administrativeconfiguration/input.go`

Lines: 97

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate administrative input and generate the canonical mock-administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated input, authority, or canonical environment bytes; errors are fail-closed.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Environment generation only; no persistence or external effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Defines public-origin authority and immutable mock-only power invariants.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/administrativeconfiguration Go suite and TypeScript profile-equivalence tests.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `validPublicOrigin`

File: `deployment/internal/administrativeconfiguration/input.go`

Lines: 114

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate administrative input and generate the canonical mock-administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated input, authority, or canonical environment bytes; errors are fail-closed.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Environment generation only; no persistence or external effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Defines public-origin authority and immutable mock-only power invariants.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/administrativeconfiguration Go suite and TypeScript profile-equivalence tests.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `PublicOriginAuthority`

File: `deployment/internal/administrativeconfiguration/input.go`

Lines: 199

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate administrative input and generate the canonical mock-administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated input, authority, or canonical environment bytes; errors are fail-closed.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Environment generation only; no persistence or external effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Defines public-origin authority and immutable mock-only power invariants.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/administrativeconfiguration Go suite and TypeScript profile-equivalence tests.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `Environment`

File: `deployment/internal/administrativeconfiguration/input.go`

Lines: 384

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate administrative input and generate the canonical mock-administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated input, authority, or canonical environment bytes; errors are fail-closed.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Environment generation only; no persistence or external effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Defines public-origin authority and immutable mock-only power invariants.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/administrativeconfiguration Go suite and TypeScript profile-equivalence tests.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `environmentWithoutPublicOrigin`

File: `deployment/internal/administrativeconfiguration/input.go`

Lines: 385

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate administrative input and generate the canonical mock-administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated input, authority, or canonical environment bytes; errors are fail-closed.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Environment generation only; no persistence or external effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Defines public-origin authority and immutable mock-only power invariants.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/administrativeconfiguration Go suite and TypeScript profile-equivalence tests.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `applyPowerSurfaceFlags`

File: `deployment/internal/administrativeconfiguration/input.go`

Lines: 421

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate administrative input and generate the canonical mock-administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated input, authority, or canonical environment bytes; errors are fail-closed.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Environment generation only; no persistence or external effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Defines public-origin authority and immutable mock-only power invariants.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/administrativeconfiguration Go suite and TypeScript profile-equivalence tests.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `addPublicOrigin`

File: `deployment/internal/administrativeconfiguration/input.go`

Lines: 389

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate administrative input and generate the canonical mock-administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated input, authority, or canonical environment bytes; errors are fail-closed.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Environment generation only; no persistence or external effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Defines public-origin authority and immutable mock-only power invariants.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/administrativeconfiguration Go suite and TypeScript profile-equivalence tests.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `New`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 143

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `administrativeHost`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 179

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `validateConfiguration`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 297

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `isAdministrativeProfile`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 325

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `parseAdministrativeProfile`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 163

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `parseEnvironment`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 180

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `validEnvironmentKey`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 440

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `parseBoolean`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 394

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `hasEnvironmentKey`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 409

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `looksAdministrativeProfile`

File: `deployment/internal/servicelifecycle/lifecycle.go`

Lines: 169

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Select the correct lifecycle verifier from a structurally parsed persisted profile and validate its state binding.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: A configured service, validated profile/authority, or a fail-closed configuration error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads persisted environment/state; lifecycle actions own later systemd mutations.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects duplicate or malformed keys, preserves current and legacy administrative variants, and prevents fallback of malformed administrative profiles.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/servicelifecycle, including duplicate, CRLF, legacy, partial and invalid-flag cases.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `Verify`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 63

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `VerifyAdministrative`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 96

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `verifyAdministrativeRoute`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 120

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `administrativeProbeBody`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 132

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `verifyHealth`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 70

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `isRetryableHealthFailure`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 163

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `verifyHealthOnce`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 159

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `verifyAbsent`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 77

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `verifyAbsentWithHost`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 135

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `verifyProtected`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 115

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `verifyProtectedWithBody`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 133

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `verifyIdentity`

File: `deployment/internal/runtimeverification/verification.go`

Lines: 124

Language: Go

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Verify health, route presence/protection, authority separation and runtime identity without authenticated mutation.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Nil on verified runtime state or a stable lifecycle verification error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only loopback HTTP probes and process identity reads; no persistence or power effects.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Enabled mutations receive valid mock-only bodies but no assertion, proving 401/403 before use-case execution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: deployment/internal/runtimeverification and lifecycle integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `parseMockAdministrativeInput`

File: `src/config/administrative-runtime-profile.ts`

Lines: 31

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Parse bounded profile input and produce the TypeScript canonical administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Frozen validated input/environment or a validation exception.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Pure parsing and mapping; no persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects unknown fields and preserves mock backend, disabled effects and disabled machine scheduler.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/config/administrative-runtime-profile.test.ts and Go/TS equivalence checks.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `createMockAdministrativeEnvironment`

File: `src/config/administrative-runtime-profile.ts`

Lines: 130

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Parse bounded profile input and produce the TypeScript canonical administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Frozen validated input/environment or a validation exception.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Pure parsing and mapping; no persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects unknown fields and preserves mock backend, disabled effects and disabled machine scheduler.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/config/administrative-runtime-profile.test.ts and Go/TS equivalence checks.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `isRecord`

File: `src/config/administrative-runtime-profile.ts`

Lines: 36

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Parse bounded profile input and produce the TypeScript canonical administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Frozen validated input/environment or a validation exception.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Pure parsing and mapping; no persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects unknown fields and preserves mock backend, disabled effects and disabled machine scheduler.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/config/administrative-runtime-profile.test.ts and Go/TS equivalence checks.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `hasOnlyKeys`

File: `src/config/administrative-runtime-profile.ts`

Lines: 37

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Parse bounded profile input and produce the TypeScript canonical administrative environment.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Frozen validated input/environment or a validation exception.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Pure parsing and mapping; no persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects unknown fields and preserves mock backend, disabled effects and disabled machine scheduler.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/config/administrative-runtime-profile.test.ts and Go/TS equivalence checks.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `createAdministrativeRuntime`

File: `src/http/create-administrative-runtime.ts`

Lines: 76

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Compose activated administrative routes, protected use cases, gates and overview capabilities.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Administrative runtime registration bound to authoritative configuration.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Registers HTTP handlers; persistence and audit remain in application use cases.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Keeps Host/origin/authentication/RBAC and route-catalog reconciliation backend-authoritative.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: administrative control-plane, catalog, authentication and power integration suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `registerAdministrativeOverviewRoute`

File: `src/http/administrative-overview-route.ts`

Lines: 34

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the protected operational overview and authoritative capability flags.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded overview JSON or mapped administrative HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only HTTP response and authorization audit.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Capabilities come from runtime configuration and pass common admission/authentication/RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: administrative control-plane and authenticated dashboard suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `createHandler`

File: `src/http/administrative-overview-route.ts`

Lines: 41

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the protected operational overview and authoritative capability flags.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded overview JSON or mapped administrative HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only HTTP response and authorization audit.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Capabilities come from runtime configuration and pass common admission/authentication/RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: administrative control-plane and authenticated dashboard suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `process`

File: `src/http/administrative-overview-route.ts`

Lines: 62

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the protected operational overview and authoritative capability flags.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded overview JSON or mapped administrative HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only HTTP response and authorization audit.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Capabilities come from runtime configuration and pass common admission/authentication/RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: administrative control-plane and authenticated dashboard suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `send`

File: `src/http/administrative-overview-route.ts`

Lines: 89

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the protected operational overview and authoritative capability flags.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded overview JSON or mapped administrative HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only HTTP response and authorization audit.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Capabilities come from runtime configuration and pass common admission/authentication/RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: administrative control-plane and authenticated dashboard suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `mapError`

File: `src/http/administrative-overview-route.ts`

Lines: 63

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the protected operational overview and authoritative capability flags.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded overview JSON or mapped administrative HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Read-only HTTP response and authorization audit.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Capabilities come from runtime configuration and pass common admission/authentication/RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: administrative control-plane and authenticated dashboard suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `getAdministrativeDashboardAssetSnapshot`

File: `src/http/administrative-dashboard-route.ts`

Lines: 78

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the authenticated dashboard shell and allowlisted generated assets.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Protected HTML/asset response or safe mapped error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads packaged assets and writes HTTP responses; no domain mutation.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Shell and assets share Host/origin, Cloudflare assertion, principal and RBAC boundaries.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: authenticated dashboard integration and dashboard asset generation suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `readDashboardSource`

File: `src/http/administrative-dashboard-route.ts`

Lines: 61

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the authenticated dashboard shell and allowlisted generated assets.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Protected HTML/asset response or safe mapped error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads packaged assets and writes HTTP responses; no domain mutation.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Shell and assets share Host/origin, Cloudflare assertion, principal and RBAC boundaries.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: authenticated dashboard integration and dashboard asset generation suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `registerAdministrativeDashboardRoutes`

File: `src/http/administrative-dashboard-route.ts`

Lines: 110

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the authenticated dashboard shell and allowlisted generated assets.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Protected HTML/asset response or safe mapped error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads packaged assets and writes HTTP responses; no domain mutation.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Shell and assets share Host/origin, Cloudflare assertion, principal and RBAC boundaries.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: authenticated dashboard integration and dashboard asset generation suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `createShellHandler`

File: `src/http/administrative-dashboard-route.ts`

Lines: 117

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the authenticated dashboard shell and allowlisted generated assets.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Protected HTML/asset response or safe mapped error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads packaged assets and writes HTTP responses; no domain mutation.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Shell and assets share Host/origin, Cloudflare assertion, principal and RBAC boundaries.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: authenticated dashboard integration and dashboard asset generation suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `createAssetHandler`

File: `src/http/administrative-dashboard-route.ts`

Lines: 122

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the authenticated dashboard shell and allowlisted generated assets.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Protected HTML/asset response or safe mapped error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads packaged assets and writes HTTP responses; no domain mutation.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Shell and assets share Host/origin, Cloudflare assertion, principal and RBAC boundaries.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: authenticated dashboard integration and dashboard asset generation suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `createAdmissionHandler`

File: `src/http/administrative-dashboard-route.ts`

Lines: 129

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the authenticated dashboard shell and allowlisted generated assets.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Protected HTML/asset response or safe mapped error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads packaged assets and writes HTTP responses; no domain mutation.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Shell and assets share Host/origin, Cloudflare assertion, principal and RBAC boundaries.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: authenticated dashboard integration and dashboard asset generation suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `mapError`

File: `src/http/administrative-dashboard-route.ts`

Lines: 199

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Serve the authenticated dashboard shell and allowlisted generated assets.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Protected HTML/asset response or safe mapped error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Reads packaged assets and writes HTTP responses; no domain mutation.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Shell and assets share Host/origin, Cloudflare assertion, principal and RBAC boundaries.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: authenticated dashboard integration and dashboard asset generation suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `registerAdministrativeWakeAlarmRoute`

File: `src/http/administrative-wake-alarm-route.ts`

Lines: 54

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose authoritative wake state and strictly validated mock wake mutations.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded wake observation/mutation JSON or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Protected use case may update mock wake state and event history after admission.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Strict JSON for PUT, no body for DELETE, shared power gate, authentication, RBAC and audit.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: wake-alarm route, integration, catalog and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `createAdministrativeWakeAlarmHandler`

File: `src/http/administrative-wake-alarm-route.ts`

Lines: 61

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose authoritative wake state and strictly validated mock wake mutations.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded wake observation/mutation JSON or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Protected use case may update mock wake state and event history after admission.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Strict JSON for PUT, no body for DELETE, shared power gate, authentication, RBAC and audit.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: wake-alarm route, integration, catalog and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `processRequest`

File: `src/http/administrative-wake-alarm-route.ts`

Lines: 82

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose authoritative wake state and strictly validated mock wake mutations.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded wake observation/mutation JSON or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Protected use case may update mock wake state and event history after admission.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Strict JSON for PUT, no body for DELETE, shared power gate, authentication, RBAC and audit.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: wake-alarm route, integration, catalog and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readScheduleBody`

File: `src/http/administrative-wake-alarm-route.ts`

Lines: 106

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose authoritative wake state and strictly validated mock wake mutations.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded wake observation/mutation JSON or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Protected use case may update mock wake state and event history after admission.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Strict JSON for PUT, no body for DELETE, shared power gate, authentication, RBAC and audit.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: wake-alarm route, integration, catalog and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `sendBoundedResponse`

File: `src/http/administrative-wake-alarm-route.ts`

Lines: 132

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose authoritative wake state and strictly validated mock wake mutations.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded wake observation/mutation JSON or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Protected use case may update mock wake state and event history after admission.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Strict JSON for PUT, no body for DELETE, shared power gate, authentication, RBAC and audit.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: wake-alarm route, integration, catalog and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `mapWakeAlarmError`

File: `src/http/administrative-wake-alarm-route.ts`

Lines: 145

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose authoritative wake state and strictly validated mock wake mutations.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Bounded wake observation/mutation JSON or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Protected use case may update mock wake state and event history after admission.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Strict JSON for PUT, no body for DELETE, shared power gate, authentication, RBAC and audit.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: wake-alarm route, integration, catalog and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `registerAdministrativeShutdownRoutes`

File: `src/http/administrative-shutdown-route.ts`

Lines: 63

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate and execute two-stage mock shutdown preparation/execution through protected use cases.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Canonical preparation/execution result or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: May persist mock occurrence claims and audit events after admission and authorization.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Requires strict body, canonical occurrence, exact stage confirmation, shared power gate, authentication and RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown route, integration, confirmation, claim and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `createAdministrativeShutdownHandler`

File: `src/http/administrative-shutdown-route.ts`

Lines: 70

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate and execute two-stage mock shutdown preparation/execution through protected use cases.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Canonical preparation/execution result or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: May persist mock occurrence claims and audit events after admission and authorization.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Requires strict body, canonical occurrence, exact stage confirmation, shared power gate, authentication and RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown route, integration, confirmation, claim and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `processShutdownRequest`

File: `src/http/administrative-shutdown-route.ts`

Lines: 97

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate and execute two-stage mock shutdown preparation/execution through protected use cases.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Canonical preparation/execution result or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: May persist mock occurrence claims and audit events after admission and authorization.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Requires strict body, canonical occurrence, exact stage confirmation, shared power gate, authentication and RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown route, integration, confirmation, claim and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readShutdownBody`

File: `src/http/administrative-shutdown-route.ts`

Lines: 128

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate and execute two-stage mock shutdown preparation/execution through protected use cases.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Canonical preparation/execution result or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: May persist mock occurrence claims and audit events after admission and authorization.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Requires strict body, canonical occurrence, exact stage confirmation, shared power gate, authentication and RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown route, integration, confirmation, claim and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `parseShutdownRequest`

File: `src/http/administrative-shutdown-route.ts`

Lines: 129

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate and execute two-stage mock shutdown preparation/execution through protected use cases.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Canonical preparation/execution result or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: May persist mock occurrence claims and audit events after admission and authorization.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Requires strict body, canonical occurrence, exact stage confirmation, shared power gate, authentication and RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown route, integration, confirmation, claim and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `createRequestConfirmationReader`

File: `src/http/administrative-shutdown-route.ts`

Lines: 138

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate and execute two-stage mock shutdown preparation/execution through protected use cases.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Canonical preparation/execution result or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: May persist mock occurrence claims and audit events after admission and authorization.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Requires strict body, canonical occurrence, exact stage confirmation, shared power gate, authentication and RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown route, integration, confirmation, claim and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `sendBoundedResponse`

File: `src/http/administrative-shutdown-route.ts`

Lines: 154

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate and execute two-stage mock shutdown preparation/execution through protected use cases.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Canonical preparation/execution result or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: May persist mock occurrence claims and audit events after admission and authorization.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Requires strict body, canonical occurrence, exact stage confirmation, shared power gate, authentication and RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown route, integration, confirmation, claim and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `mapShutdownError`

File: `src/http/administrative-shutdown-route.ts`

Lines: 161

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Validate and execute two-stage mock shutdown preparation/execution through protected use cases.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Canonical preparation/execution result or deterministic HTTP error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: May persist mock occurrence claims and audit events after admission and authorization.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Requires strict body, canonical occurrence, exact stage confirmation, shared power gate, authentication and RBAC.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown route, integration, confirmation, claim and power audit suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `createMachineShutdownConfirmation`

File: `src/power-management/domain/machine-shutdown-confirmation.ts`

Lines: 26

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Map exact canonical confirmation text to a shutdown stage.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Frozen confirmation value or domain validation error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Pure domain validation.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Prevents preparation/execution confirmation substitution.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: shutdown domain and route suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `readCliVersion`

File: `src/cli/main.ts`

Lines: 16

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose the installed version and dispatch CLI commands with stable human/JSON output.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: CLI exit code and formatted result.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Transport calls only for selected commands; no fabricated Cloudflare credentials.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Preserves the CLI transport boundary and stable error handling.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/cli parser, main, transport and doctor suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `runAtlasCli`

File: `src/cli/main.ts`

Lines: 27

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose the installed version and dispatch CLI commands with stable human/JSON output.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: CLI exit code and formatted result.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Transport calls only for selected commands; no fabricated Cloudflare credentials.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Preserves the CLI transport boundary and stable error handling.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/cli parser, main, transport and doctor suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `writeResult`

File: `src/cli/main.ts`

Lines: 64

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Expose the installed version and dispatch CLI commands with stable human/JSON output.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: CLI exit code and formatted result.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Transport calls only for selected commands; no fabricated Cloudflare credentials.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Preserves the CLI transport boundary and stable error handling.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/cli parser, main, transport and doctor suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `PowerControlsRequestError`

File: `src/dashboard/power-controls.ts`

Lines: 12

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `PowerControlsController`

File: `src/dashboard/power-controls.ts`

Lines: 43

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `render`

File: `src/dashboard/power-controls.ts`

Lines: 62

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `settle`

File: `src/dashboard/power-controls.ts`

Lines: 102

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `#renderWakeAlarmControls`

File: `src/dashboard/power-controls.ts`

Lines: 89

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `#renderShutdownPreparationControl`

File: `src/dashboard/power-controls.ts`

Lines: 91

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `#renderShutdownExecutionControl`

File: `src/dashboard/power-controls.ts`

Lines: 93

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `#runMutation`

File: `src/dashboard/power-controls.ts`

Lines: 141

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `formatWakeAlarm`

File: `src/dashboard/power-controls.ts`

Lines: 115

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `wakeAlarmFailureText`

File: `src/dashboard/power-controls.ts`

Lines: 118

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `mutationFailureText`

File: `src/dashboard/power-controls.ts`

Lines: 284

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `failureKind`

File: `src/dashboard/power-controls.ts`

Lines: 311

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readShutdownOccurrence`

File: `src/dashboard/power-controls.ts`

Lines: 208

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `formatLocalDateTime`

File: `src/dashboard/power-controls.ts`

Lines: 128

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readRecord`

File: `src/dashboard/power-controls.ts`

Lines: 302

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `displayValue`

File: `src/dashboard/power-controls.ts`

Lines: 72

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `hasOnlyKeys`

File: `src/dashboard/power-controls.ts`

Lines: 339

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render mock power controls, classify failures and retain only current canonical backend responses.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM state, safe status text, or validated shutdown occurrence.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Same-origin administrative reads/mutations and DOM updates; backend remains authoritative.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: No HTML injection, no physical-power inference, explicit confirmations, render-generation stale-state protection.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/power-controls.test.ts, including refresh failure, capability changes and malformed responses.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `renderMachinePlan`

File: `src/dashboard/machine-plan-view.ts`

Lines: 16

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `renderMachineSchedule`

File: `src/dashboard/machine-plan-view.ts`

Lines: 57

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `renderMachinePreview`

File: `src/dashboard/machine-plan-view.ts`

Lines: 117

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `appendTransition`

File: `src/dashboard/machine-plan-view.ts`

Lines: 51

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `findNextTransition`

File: `src/dashboard/machine-plan-view.ts`

Lines: 26

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readPlan`

File: `src/dashboard/machine-plan-view.ts`

Lines: 22

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readRecord`

File: `src/dashboard/machine-plan-view.ts`

Lines: 123

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readTransition`

File: `src/dashboard/machine-plan-view.ts`

Lines: 203

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readString`

File: `src/dashboard/machine-plan-view.ts`

Lines: 129

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `unavailablePlan`

File: `src/dashboard/machine-plan-view.ts`

Lines: 198

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readSchedule`

File: `src/dashboard/machine-plan-view.ts`

Lines: 63

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Render validated machine schedule, transition and safety information without making safety decisions.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: DOM presentation or explicit unavailable/empty state.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: DOM updates only.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Uses text nodes and presents backend-authoritative backend/effects/scheduler state.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: tests/dashboard/machine-plan-view.test.ts.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **FIXED**.

### `readJson`

File: `src/dashboard/main.ts`

Lines: 26

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `addText`

File: `src/dashboard/main.ts`

Lines: 35

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `renderOverview`

File: `src/dashboard/main.ts`

Lines: 43

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `appendOverviewCard`

File: `src/dashboard/main.ts`

Lines: 57

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `readRecord`

File: `src/dashboard/main.ts`

Lines: 52

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `displayValue`

File: `src/dashboard/main.ts`

Lines: 60

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `renderInfrastructure`

File: `src/dashboard/main.ts`

Lines: 131

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `renderServices`

File: `src/dashboard/main.ts`

Lines: 168

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `renderAudit`

File: `src/dashboard/main.ts`

Lines: 275

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `renderMachinePlan`

File: `src/dashboard/main.ts`

Lines: 281

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `renderAvailability`

File: `src/dashboard/main.ts`

Lines: 317

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `renderBackups`

File: `src/dashboard/main.ts`

Lines: 343

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `appendBackupPolicyForm`

File: `src/dashboard/main.ts`

Lines: 384

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `appendBackupActionForm`

File: `src/dashboard/main.ts`

Lines: 400

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `powerControlsHttpError`

File: `src/dashboard/main.ts`

Lines: 31

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `mutatePowerState`

File: `src/dashboard/main.ts`

Lines: 531

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `refresh`

File: `src/dashboard/main.ts`

Lines: 228

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.

### `createPreviewWindow`

File: `src/dashboard/main.ts`

Lines: 610

Language: TypeScript

Visibility: determined by the source signature; private members retain their private boundary.

Purpose: Coordinate dashboard reads, renders and protected mutations through same-origin administrative APIs.

Inputs: the typed parameters at the reviewed HEAD; unknown HTTP/dashboard data is validated before use.

Outputs: Validated data, DOM state, or classified request error.

Errors: validation and dependency failures are propagated or mapped to the layer's stable error contract.

Side effects: Fetch and DOM updates; application/domain layers own mutations and persistence.

Persistence: no direct persistence unless stated in side effects; application/infrastructure owners retain persistence authority.

Concurrency: shared admission gates, lifecycle locks, occurrence claims or render generations apply where the function participates in mutation.

Security relevance: Rejects redirects, encodes dynamic targets, uses safe DOM APIs and never fabricates Access headers.

Callers: direct callers were traced in the same file and composition root at the reviewed HEAD.

Callees: typed domain/application/infrastructure dependencies referenced by the implementation.

Tests: dashboard, control-plane, service, backup and authentication suites.

Potential defects: no unresolved P0/P1 after the follow-up fixes recorded in `pr-301-findings.md`.

Verdict: **PASS**.
