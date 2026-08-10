# Atlas Manager reverse proxy

Nginx sits between the Cloudflare Tunnel and Atlas Manager on the
administrative path. Its configuration is part of the security boundary, not an
incidental deployment detail: two of the invariants below correspond to defects
that have already happened on Atlas.

The reference template is versioned at
[`deployment/nginx/atlas-manager-admin.conf`](../../deployment/nginx/atlas-manager-admin.conf).
It is a template, not an installed artifact — the installer never writes Nginx
configuration, and no rehearsal asserts its content. Keeping it here means a
future reinstallation can be diffed against a known-good baseline instead of
being reconstructed from memory.

## Request path

```text
Browser
  -> Cloudflare Access policy
  -> Cloudflare Tunnel
  -> Nginx administrative server block   (this configuration)
  -> Atlas Manager on 127.0.0.1:3000
```

## Invariants

### Forward the Cloudflare Access assertion

```nginx
proxy_set_header Cf-Access-Jwt-Assertion $http_cf_access_jwt_assertion;
```

Nginx drops headers whose names contain underscores by default. Without this
line the operator authenticates at Cloudflare Access, the tunnel delivers the
request, and Atlas Manager answers
`administrative_authentication_required`, because the assertion never arrived.

This is the first defect from the
[2026-08-09 incident](../incidents/2026-08-09-cloudflare-access-dashboard-authentication.md).
Authentication failures are deliberately mapped to one generic 401, so the
browser-visible error does not say which check failed. Verify the header
explicitly after any proxy change.

### Pass the administrative hostname

```nginx
proxy_set_header Host $host;
```

The application validates `Host` against `ADMINISTRATIVE_PUBLIC_ORIGIN` and
rejects a mismatch with `400 administrative_host_rejected`. Passing
`$proxy_host` sends `127.0.0.1:3000` and every administrative request fails.

### Never expose the health endpoints

```nginx
location /health/ {
    deny all;
    return 404;
}
```

`/health/live` and `/health/server` are unauthenticated by design: local
supervision and the documented `curl` checks depend on them, and the
application binds to the loopback interface whenever administration is enabled.

That decision is safe **only** while both conditions hold: the process stays
loopback-bound, and the reverse proxy does not publish the paths.
`/health/server` reports host memory, CPU usage and temperature, three load
averages and disk usage. The application sends `no-store`, `nosniff`,
`DENY` and a restrictive CSP on these responses, but headers do not make the
data non-sensitive — they only limit what a browser or cache does with it.

If Atlas Manager is ever configured to listen beyond the loopback interface,
revisit this decision before deploying.

## Verification after any proxy change

```bash
sudo nginx -t
sudo systemctl reload nginx

# Health must not be reachable through the public hostname.
curl -sS -o /dev/null -w '%{http_code}\n' https://admin.gustavopinto.dev.br/health/server   # expect 404

# Health must still answer on the host itself.
curl --fail http://127.0.0.1:3000/health/live

# An authenticated dashboard read must succeed, not merely redirect to Access.
```

A 302 from Cloudflare Access proves only that the edge policy is attached. The
acceptance check is an authenticated administrative read, per the incident's
prevention notes.
