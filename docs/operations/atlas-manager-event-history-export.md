# Atlas Manager event-history export

Exports are protected, local, canonical JSON Lines snapshots. The operator
must provide both `fromSequence` and `throughSequence`; the cutoff is explicit
and bounded by the retained history observed before creation. Export IDs are
the SHA-256 of the complete bytes. A verified export can be downloaded only
through its protected same-origin ID route.

There is no arbitrary filename, path, range request, external destination,
content browsing, or export of JWTs, confirmations, secrets, process data, or
filesystem paths. Equivalent inputs and a fixed clock produce identical bytes.
