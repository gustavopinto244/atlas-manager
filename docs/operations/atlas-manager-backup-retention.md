# Atlas Manager backup retention

Retention runs only against verified managed successful artifacts. It applies
the configured successful-count and age policy in deterministic order and
preserves the minimum successful count.

Unknown artifacts, modified manifests, unsafe metadata, links, and mismatched
run identities block pruning. Partial deletion is reported as a state that
requires authoritative inspection; no restoration or automatic retry occurs.
