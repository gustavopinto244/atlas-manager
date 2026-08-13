# Mock-administrative runtime configuration

The immutable bundle contains the example input
`atlas-manager.mock-admin.input.example.json`. The operator must install the
real input at the fixed root-managed path
`/etc/atlas-manager/administrative-runtime.input.json`. The real input is
never placed inside the bundle, and the tool accepts no caller-selected path.

The file must be a regular root-owned file with mode `0600`. Its
`cloudflareTeamName` is the Cloudflare team domain, `cloudflareAudience` is the
Access application AUD, and each `principalId` must match the JWT `sub`
exactly. Canonical lowercase UUID v4 and v5 identifiers are supported.

The example separates the required human/bootstrap `administrator` assignment
from an automation principal that combines `auditor`, `service_operator`, and
`backup_operator`. Reduce the automation set when fewer capabilities are
needed, and use separate least-privilege service principals for unrelated
automations. The `administrator` role is not the default recommendation for a
service token.

The administrative origin is `https://admin.gustavopinto.dev.br` without an
`/admin` path. The public flow is:

```text
Internet → Cloudflare Access → Cloudflare Tunnel → Nginx loopback → Atlas Manager 127.0.0.1:3000
```

The dedicated hostname must have its own Cloudflare Access application and
policy.

The Go tool `atlas-manager-administrative-runtime-configuration` supports only
`inspect`, `validate-input`, `install-disabled`, `verify-installed`, and
`remove-disabled`. Installation requires the exact confirmation
`confirm_atlas_manager_mock_administrative_configuration`; removal requires
`confirm_atlas_manager_mock_administrative_configuration_removal`.

The generated environment enables the event-history, service-management,
availability, overview, and dashboard surfaces. It keeps `HOST=127.0.0.1`,
`POWER_MANAGEMENT_BACKEND=mock`, `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`,
`MACHINE_POWER_SCHEDULER_ENABLED=false`, and the always-on machine policy.
By default, wake and shutdown HTTP remain disabled. For a safe simulation-only
profile, the input may additionally contain `wakeAlarmHttpEnabled: true` and
`shutdownHttpEnabled: true`. The resulting routes use mock adapters; physical
effects remain disabled and the machine scheduler remains disabled. Shutdown
simulation also declares separate machine-power cursor and occurrence-claim
files.

The real environment file is installed atomically with root-private managed
state and is removable only when its bytes and metadata still match the managed
profile.

This profile does not create accounts, install a helper, enable a scheduler,
or activate a power effect. The TypeScript parser remains authoritative for the
generated environment semantics.

The profile uses the fixed v2 event-history directory and strict segment and
retention policy fields. The legacy single-file setting is migration input only
and cannot be configured together with v2 operational routes.
