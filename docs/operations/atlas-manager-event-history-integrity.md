# Atlas Manager event-history integrity

The v2 event history is a private segmented store. Every record has a
canonical SHA-256 hash and points to the previous record. Sealed segments have
canonical manifests and form a second chain. Retention anchors explicitly
describe removed sequence ranges, so pruning never looks like an unexplained
gap.

The protected integrity endpoint and the maintenance `verify` action are
read-only. Results are `verified`, `verified_with_retention`, `broken`,
`interrupted`, or `unavailable`. A broken or interrupted store blocks writes,
audited operations, rotation, retention, and exports. The system does not
repair, truncate, renumber, adopt, or delete unknown state automatically.

The hash chain is deterministic integrity evidence, not external authenticity
or non-repudiation.
