# Atlas Manager backup scheduler

Scheduled targets use the existing weekly schedule and
`America/Sao_Paulo` timezone primitives. Each tick is explicit, bounded to 32
occurrences, and claims `(targetId, scheduledFor)` before execution. Claims are
permanent and prevent duplicate execution after restart or retry.

Automatic scheduling is disabled by default. When explicitly enabled it uses a
fixed 60-second cadence, does not queue overlapping ticks, and isolates a
failed tick from the application process. The protected scheduler-tick route
does not enable the lifecycle.
