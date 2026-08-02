# Atlas Manager event-history rotation

The active segment is bounded by configured event and byte limits. Rotation is
automatic before the next record would exceed a limit and is also available as
a protected operator action. The writer lock and transaction journal cover
active synchronization, sealed-segment publication, manifest publication, and
new-active creation.

A failed pre-publication candidate may be cleaned only when it is proven to be
the current attempt. Partial publication leaves transaction evidence and
requires inspection. No event is discarded or renumbered to make recovery
appear successful.
