# Atlas Manager backup recovery

A started run without a terminal record is `interrupted`. It remains visible in
run history, is never treated as success, and blocks shutdown readiness.
Occurrence claims are not released automatically. Corrupt history, cursor, or
claim files fail closed.

Operators must inspect the bounded project-owned state and decide the next
reviewed action. There is no force, repair, adopt, restore, or automatic rerun
action in this milestone. Unknown candidate and artifact directories are never
deleted automatically.

Backup-run metadata remains separate from administrative event history. The
event-history v2 chain, rotation journal, retention anchors, and canonical
exports are operated through the event-history runbooks; they are not a
backup-run database and are not automatically repaired.
