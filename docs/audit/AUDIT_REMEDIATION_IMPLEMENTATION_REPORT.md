# Atlas Manager audit-remediation implementation report

## Execution identity

- baseline: `162191dae6415cc33aab4e30a2cb60be7845cb5f`;
- branch: `fix/v1-rc-audit-remediation`;
- target: `1.0.0-rc.2`;
- bundle SHA-256: `9999edb750a0c5305c92100dce5698c676b7d7bfefee492e8ee0fb2189d1a15e` (two identical builds);
- administrative API contract SHA-256: `760b1691f91f4bd6edc951315858df070a44b94fb3aeff3dab249c6c43e96623`;
- release contract SHA-256: `761156953ecc51bbbc074a303394c8ba88f5f93739be29b48d45bc620eca8eb9`;
- production dependency inventory SHA-256: `d80672e8375098d188477297e51b4b6063258708f9574363d48f47b68ffb515b`;
- requirements traceability SHA-256: `8ccaf9255c52dbc6b4a7d6815b7cb0cc3aa9979b36d648f6578d4f27073909c7`;
- release evidence SHA-256: `34e8d1d74360ccc5caf7ac82eea25ccf41b204591cdc3bf9e6a8a10f50a76e48`;
- scope: software-only; no real host, Cloudflare environment, systemd mutation,
  helper, RTC, D-Bus, Docker, PM2, or power effect was used.

The report remains explicit about qualification boundaries. The repository's
Go toolchain is available and the deployment and power-helper suites pass
locally. The complete administrative replacement/rollback matrix and the
full release rehearsal are still not represented by one executable local
scenario, so the release evidence remains fail-closed.

## Finding status

| Finding      | Severity    | Root cause                                                                                          | Resolution                                                                                                      | Tests                                                        | Status                                  |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| AUD-HIGH-001 | High        | Managed directories were created with group-readable `0750` while stores require private roots      | systemd and store contract now use `0700`; unsafe metadata still rejects                                        | unit, store, lifecycle suites                                | RESOLVED                                |
| AUD-HIGH-002 | High        | Backup run store trusted reconstructed memory after on-disk mutation                                | persistent snapshot, append-only change detection, permanent failure state, and process-safe append lock        | file-store corruption and process reconstruction tests       | RESOLVED                                |
| AUD-HIGH-003 | High        | Sequence allocation depended on a bounded query page and disk append preceded state validation      | store-authoritative numeric allocation and transition validation                                                | 102-run and transition suites                                | RESOLVED                                |
| AUD-HIGH-004 | High        | Retention inspected only 100 runs and could delete protected recent artifacts                       | bounded pagination and explicit protected recent set                                                            | 102-artifact retention suite                                 | RESOLVED                                |
| AUD-HIGH-005 | High        | Retention writer chained the hash of a ledger line instead of the canonical record hash             | subsequent anchors now chain `retentionRecordSha256`                                                            | repeated-prune reconstruction/export suite                   | RESOLVED                                |
| AUD-HIGH-006 | High        | Express route registration and catalog were independent                                             | route registration helper records descriptors and startup reconciles actual registrations                       | catalog and HTTP composition suites                          | RESOLVED                                |
| AUD-HIGH-007 | High        | Configuration generations did not preserve authoritative input evidence across replacement/rollback | current/previous input evidence, atomic candidates, hash verification, interrupted-state blocking               | deployment Go suite; full TS-parser lifecycle still required | IMPLEMENTED_PENDING_EXTERNAL_VALIDATION |
| AUD-HIGH-008 | High        | Release artifacts contained stale baselines/placeholders and did not derive qualification           | rc.2 generators, exact dependency inventory, evidence validator, and CI gates added                             | artifact validator; full CI rehearsal required               | IMPLEMENTED_PENDING_EXTERNAL_VALIDATION |
| AUD-MED-001  | Medium      | Host parser accepted URL syntax outside an authority                                                | strict hostname/port authority validation                                                                       | public-origin tests                                          | RESOLVED                                |
| AUD-MED-002  | Medium      | Export inventory did not verify complete content/manifest pairs                                     | pair inventory, content hash, ID, byte count, and safe download verification                                    | event-history export suite                                   | RESOLVED                                |
| AUD-MED-003  | Medium      | Migration published directly into the final root and receipt parsing was permissive                 | candidate root, source recheck, strict receipt parse, atomic publication                                        | migration suite                                              | RESOLVED                                |
| AUD-MED-004  | Medium      | Dashboard had separate runtime, source, and Go asset definitions                                    | runtime catalog/asset source was aligned and safe DOM behavior retained; bundle equivalence remains CI evidence | dashboard HTTP and bundle tests                              | IMPLEMENTED_PENDING_EXTERNAL_VALIDATION |
| AUD-MED-005  | Medium      | Identity cache state was not represented in readiness and posture was declarative                   | readiness now reports cached-key state and runtime status derives actual flags                                  | JWKS readiness matrix                                        | RESOLVED                                |
| AUD-MED-006  | Medium      | Dependency report covered only direct packages                                                      | deterministic transitive production lock-tree inventory with license/integrity checks                           | generator and release validator                              | RESOLVED                                |
| AUD-MED-007  | Medium      | Declared matrices were not all executable                                                           | focused regression suites and release CI gate added                                                             | Node suites; Go/rehearsal CI required                        | IMPLEMENTED_PENDING_EXTERNAL_VALIDATION |
| AUD-LOW-001  | Low         | Correlation ID was not included in rejected-administration logs                                     | bounded administrative rejection logging includes generated correlation ID                                      | HTTP/error-handler suites                                    | RESOLVED                                |
| AUD-LOW-002  | Low         | Fetch Metadata destination had only syntactic validation                                            | fixed destination vocabulary and mode/destination semantics                                                     | HTTP envelope suites                                         | RESOLVED                                |
| AUD-LOW-003  | Low         | Historical documents retained contradictory current-release claims                                  | rc.2 release docs and supersession language updated                                                             | release artifact validator                                   | RESOLVED                                |
| AUD-LOW-004  | Low         | CI action/tool references were not fully immutable                                                  | retained as supply-chain follow-up where upstream digest policy is unavailable                                  | CI review                                                    | ACCEPTED_WITH_DOCUMENTED_LIMIT          |
| AUD-INFO-001 | Informative | External dependency checks are future scope                                                         | explicitly deferred; no unreviewed network check added                                                          | none required                                                | DEFERRED                                |
| AUD-INFO-002 | Informative | Maintenance response is future scope                                                                | explicitly deferred by requirements/roadmap                                                                     | none required                                                | DEFERRED                                |
| AUD-INFO-003 | Informative | Physical effects are not software qualification                                                     | preserved as a separate physical gate                                                                           | safety review                                                | ACCEPTED_LIMIT                          |

## Validation state

Passed locally: TypeScript formatting, lint, typecheck, build, serialized Node
suite with the deterministic helper fixture (199 files, 2,673 passed, no
skips), production npm audit,
deployment Go formatting/module verification/vet/tests, power-helper Go
formatting/module verification/vet/tests, Linux amd64 executable builds,
reproducible bundle builds and inspection, release artifact
generation/validation, and focused persistence, HTTP, identity, migration,
and event-history tests. The Go configuration path now invokes the fixed
bundled TypeScript security parser before installation, replacement, or
rollback; a complete end-to-end configuration fixture remains pending.

The two explicit bundle builds were byte-identical. Bundle inspection passed
and the packaged smoke test passed using a temporary application root, a
loopback-only listener, and the pinned local Node 24 binary. This environment
does not provide `/usr/bin/node`, the fixed production unit path, so that
specific host-runtime check remains part of deployment qualification.

`npm audit --omit=dev` reported zero vulnerabilities. The full `npm audit`
reported one high development-only advisory in `brace-expansion` through
ESLint; no dependency update was performed, and the production gate remains
green.

Not completed locally: the full deterministic release rehearsal and the
single end-to-end administrative configuration replacement/rollback scenario.
The dashboard source/runtime/bundle equivalence also remains an external
qualification item. The release evidence therefore remains `not_qualified`.

## Residual and physical gates

The software candidate continues to reject arbitrary commands and paths, does
not store Access assertions in the browser, does not trust forwarded headers,
and does not activate real power effects. Physical Atlas deployment, real
Cloudflare ingress, helper installation/ownership, RTC wake verification, and
real shutdown acceptance remain separately approved gates.
