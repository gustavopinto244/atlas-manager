# Atlas Manager event-history migration

Version-one migration is explicit and offline. `migrate-v1` requires the exact
confirmation `confirm_administrative_event_history_v1_migration`, validates
the complete legacy file, reconstructs events through the existing domain
parser, writes and verifies a v2 candidate store, and preserves the v1 source.

Migration is not automatic at startup. A migration receipt contains only
bounded counts, sequence boundaries, source digest, chain head, and result.
Repeating an equivalent completed migration returns `unchanged`.
