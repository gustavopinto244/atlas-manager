# Atlas Manager event-history retention

Retention is disabled automatically by default. A reviewed policy controls the
minimum and maximum sealed segments and exports plus bounded age limits. Only
complete verified managed objects are eligible. The active segment is never
pruned. Before deleting segments, Atlas Manager appends a canonical chained
retention anchor and then verifies the retained chain.

Unknown files, modified manifests, unsafe metadata, broken chains, locks, and
transactions block pruning. Partial deletion remains visible and requires
operator inspection; there is no automatic restoration or retry.
