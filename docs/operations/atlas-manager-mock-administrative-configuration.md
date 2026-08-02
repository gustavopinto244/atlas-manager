# Mock-administrative runtime configuration

The bundle contains the example sibling input
`atlas-manager.mock-admin.input.example.json`. An operator may provide the
real sibling file `atlas-manager.mock-admin.input.json`; it is never bundled,
copied to source control, or accepted from a caller-selected path.

The Go tool `atlas-manager-administrative-runtime-configuration` supports only
`inspect`, `validate-input`, `install-disabled`, `verify-installed`, and
`remove-disabled`. Installation requires the exact confirmation
`confirm_atlas_manager_mock_administrative_configuration`; removal requires
`confirm_atlas_manager_mock_administrative_configuration_removal`.

The generated environment enables the event-history, service-management,
availability, overview, and dashboard surfaces. It keeps `HOST=127.0.0.1`,
`POWER_MANAGEMENT_BACKEND=mock`, `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`,
`MACHINE_POWER_SCHEDULER_ENABLED=false`, and the always-on machine policy.
Wake and shutdown HTTP remain disabled. The real environment file is installed
atomically with root-private managed state and is removable only when its
bytes and metadata still match the managed profile.

This profile does not create accounts, install a helper, enable a scheduler,
or activate a power effect. The TypeScript parser remains authoritative for the
generated environment semantics.

The profile uses the fixed v2 event-history directory and strict segment and
retention policy fields. The legacy single-file setting is migration input only
and cannot be configured together with v2 operational routes.
