# Atlas Manager mock service lifecycle

The service lifecycle is a separate operator boundary. It controls only the
fixed `atlas-manager.service` unit and supports:

```text
atlas-manager-service-lifecycle inspect
atlas-manager-service-lifecycle activate-mock confirm_atlas_manager_mock_service_activation
atlas-manager-service-lifecycle verify-active-mock
atlas-manager-service-lifecycle deactivate confirm_atlas_manager_service_deactivation
atlas-manager-service-lifecycle verify-inactive
```

Activation requires a valid disabled deployment, managed runtime identities,
the exact mock-only environment, and an inactive disabled service. It invokes
only the fixed `/usr/bin/systemctl` commands. After startup it verifies the
fixed loopback health endpoints, systemd state, and the exact mock runtime
identity. For the plain disabled profile it verifies that every managed
administrative surface is absent. For the administrative profile it sends
credential-free, read-only probes to the dashboard shell/assets, event
history/integrity, services/availability/schedule, overview, backups, and
security-status surfaces and requires the shared authentication envelope to
reject each one; power routes must independently match their configured
enabled/disabled state. These probes cannot invoke a target capability or a
mutation. The process must not belong to `atlas-manager-power`; helper-group
membership is reserved for a separately selected future power-enabled profile
and is rejected here (ADR-035).

Failure rolls back only service enablement and activity. If rollback is
incomplete, the private transaction journal remains and future mutations are
blocked until an operator reviews it. Deactivation stops and disables the
service while preserving the deployment, configuration, identities, and
application state. No automatic restart or retry is performed.

Activation also requires the fixed v2 event-history store to be fresh or
verified: required migration, stale writer locks, interrupted maintenance,
broken integrity, and unsafe retention/export state block service startup.
Event-history operational maintenance remains separately protected and does
not grant arbitrary filesystem access.
