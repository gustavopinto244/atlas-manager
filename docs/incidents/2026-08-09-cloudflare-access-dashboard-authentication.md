# Incident: administrative dashboard authentication loop

Date: 2026-08-09

Status: resolved on Atlas

Affected release: `1.0.0-rc.11`

Source commit: `928697c782e1c68bffba389d10a48b96aee74ba8`

## Impact

An operator authenticated successfully at Cloudflare Access but the Atlas
Manager dashboard returned:

```json
{"error":{"code":"administrative_authentication_required","message":"Administrative authentication required"}}
```

The administrative API remained fail-closed. There was no authentication or
RBAC bypass and no physical power effect.

## Request flow and failure boundary

```text
Browser
  -> Cloudflare Access policy: PASS
  -> Cf-Access-Jwt-Assertion injected: PASS
  -> Cloudflare Tunnel: PASS
  -> Nginx admin virtual host: PASS
  -> assertion forwarding to 127.0.0.1:3000: PASS after proxy fix
  -> Atlas assertion reader: token present
  -> Atlas JWT verification: FAIL
  -> safe public mapping: administrative_authentication_required
```

Two independent configuration defects were found during the investigation:

1. The Nginx administrative proxy initially did not explicitly forward
   `Cf-Access-Jwt-Assertion` to Atlas.
2. After forwarding was corrected, the effective
   `CLOUDFLARE_ACCESS_AUDIENCE` did not match the AUD of the Cloudflare Access
   application protecting `admin.gustavopinto.dev.br`.

The second defect was the decisive cause of the final authentication loop.
Atlas intentionally maps invalid credentials to one generic 401 response, so
the browser-visible error did not reveal which JWT validation failed.

## Diagnostic method

The investigation avoided copying or logging the assertion. A temporary,
Cloudflare-protected Nginx endpoint returned only whether the incoming header
was present:

```json
{"assertionPresent":true}
```

That result proved the Cloudflare edge boundary. The effective Atlas
configuration was then compared in memory with the known team name and
application AUD. Only boolean comparison results and SHA-256 fingerprints were
printed.

## Recovery

1. Add explicit assertion forwarding to the admin Nginx location:

   ```nginx
   proxy_set_header Cf-Access-Jwt-Assertion $http_cf_access_jwt_assertion;
   ```

2. Preserve a copy of the Nginx configuration and update the migration
   template so a future deployment does not remove the forwarding rule.
3. Back up the administrative input, generated environment and lifecycle
   state.
4. Deactivate Atlas through the qualified lifecycle tool.
5. Replace only `cloudflareAudience` in the root-owned administrative input.
6. Run `validate-input`, transactional `replace-disabled`, and
   `verify-installed`.
7. Reactivate with `activate-mock` and verify the active lifecycle.
8. Verify the effective audience, local health, external Access redirect and
   mock-only power invariants.

Evidence on Atlas:

```text
/home/guga/atlas-manager-migration/20260808T053641Z/evidence/
  cloudflare-audience-correction-20260809T232228Z
```

## Safety invariants preserved

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false
ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false
```

## Prevention work

- Treat the Cloudflare team name, application AUD, public origin and principal
  assignments as one deployment binding.
- Add a pre-deployment check that compares the configured AUD with the intended
  Access application without printing either assertion or operator identity.
- Test that the generated Nginx admin block forwards the assertion header.
- Keep authentication failures generic externally, but emit a safe internal
  failure class such as `assertion_absent`, `audience_mismatch`,
  `issuer_mismatch`, `key_unavailable` or `signature_invalid`. Never log the
  JWT, cookies, claims or assertion header.
- Remove temporary diagnostic routes after the operator acceptance check.
- Include authenticated dashboard and protected API reads in post-deployment
  acceptance, not merely a 302 response from Cloudflare Access.

## Operator troubleshooting sequence

```text
1. Does the public hostname redirect to Cloudflare Access?
2. After login, does a protected boolean diagnostic see the assertion?
3. Does Nginx explicitly forward the assertion to Atlas?
4. Do team, AUD, origin and principal bindings match effective configuration?
5. Can Atlas fetch and parse the team JWKS?
6. Does an authenticated dashboard request pass RBAC?
7. Remove diagnostics and revalidate Nginx and Atlas health.
```

Do not solve this incident by making the dashboard anonymous, trusting identity
headers without JWT verification, or bypassing backend RBAC.
