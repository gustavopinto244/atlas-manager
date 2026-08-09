# Atlas Manager 1.0.0-rc.9

`1.0.0-rc.9` is a focused dashboard-access hotfix for the qualified rc.8
deployment. Cloudflare Access returns the browser to the administrative origin
from the Access login domain, so the initial dashboard document is a legitimate
cross-site navigation even after Access has authenticated the request.

The administrative security envelope now accepts only this exact return shape:

- method `GET`;
- path `/`;
- `Sec-Fetch-Site: cross-site`;
- `Sec-Fetch-Mode: navigate`;
- `Sec-Fetch-Dest: document`.

Authentication remains mandatory after the envelope check. The Cloudflare
Access assertion is still verified, RBAC remains backend-authoritative, Host
and Origin validation remain enabled, and cross-site administrative API or
mutation requests remain rejected.

Qualification must produce two independent byte-identical bundles. Deployment
must retain mock-only physical power safety:

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
```

The administrative wake-alarm and shutdown HTTP surfaces may remain enabled,
but no real shutdown, reboot, poweroff, RTC write, or wake effect is permitted
by this release.
