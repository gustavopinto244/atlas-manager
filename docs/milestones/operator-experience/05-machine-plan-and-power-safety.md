# Machine plan and power-safety plan

## Existing capabilities

The power domain already supports machine operating policy, plan evaluation,
next shutdown occurrence planning, readiness, preparation, occurrence claims,
scheduler cursor, wake-alarm observation/mutation and shutdown execution.
Composition is mock-first; Linux effects require explicit startup admission,
runtime identity checks and the external helper protocol.

## Milestone scope

Deliver visibility and simulation first:

- machine status and current policy;
- normalized weekly operating windows;
- next planned transition;
- shutdown preparation status;
- blocking services/backups/event-history readiness;
- wake-alarm logical state and RTC information where available;
- scheduler cursor/status;
- backend and every effect gate;
- dry-run preview for a candidate logical schedule.

## Required application/API work

Expose protected read DTOs around existing use cases before adding mutation:

- machine plan;
- next transition;
- readiness/blockers;
- scheduler state;
- wake/RTC state when corresponding flags are enabled;
- candidate schedule preview.

Editing `MACHINE_OPERATING_POLICY` requires a persistent policy store and a
separate ADR defining configuration ownership, startup precedence, rollback and
audit. The application must not rewrite environment files.

## CLI and dashboard

- `atlas machine status`
- `atlas machine plan`
- `atlas machine schedule show`
- future `schedule preview/set/remove` only after the policy-store ADR

The dashboard Machine page reuses `WeeklyScheduleEditor` and
`ScheduleTimeline`, but labels transitions as machine operating windows and
shows readiness blockers and all gates prominently.

## Non-negotiable safety gates

- Automated tests use mock/fake transport only.
- Qualification and initial deployment keep physical effects disabled.
- No test invokes shutdown, reboot, poweroff, halt, real wake alarm or RTC
  writes.
- UI visibility never implies that effects are armed.
- Preview and policy persistence are separate from effect activation.
- Enabling a Linux helper remains a separately qualified operational change.

## Test plan

- plan/readiness/transition DTO mappings;
- candidate policy validation and timezone boundaries;
- blocking-service rendering;
- cursor unavailable/corrupt states;
- mock wake/shutdown behavior;
- explicit effect-gate labels;
- regression of helper protocol, identity admission and lifecycle suites.
