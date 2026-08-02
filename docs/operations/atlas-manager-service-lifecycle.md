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
fixed loopback health endpoints, absence of administrative routes, systemd
state, and the exact runtime identity.

Failure rolls back only service enablement and activity. If rollback is
incomplete, the private transaction journal remains and future mutations are
blocked until an operator reviews it. Deactivation stops and disables the
service while preserving the deployment, configuration, identities, and
application state. No automatic restart or retry is performed.
