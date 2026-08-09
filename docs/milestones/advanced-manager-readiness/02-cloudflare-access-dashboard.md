# Cloudflare Access dashboard acceptance plan

## Security contract

The desired user experience is one Cloudflare Access authentication followed
by normal dashboard navigation and authorized actions. It does not remove the
Atlas administrative envelope.

```text
Cloudflare Access session
  -> externally issued assertion
  -> Host and origin validation
  -> assertion signature, issuer and audience validation
  -> principal mapping
  -> Atlas RBAC
  -> request admission / mutation gate
  -> application use case
  -> audit event
```

No dashboard JavaScript may invent identity headers, cache the assertion in
browser storage, bypass RBAC or call infrastructure directly.

## Current page assessment

| Page           | Current source state                                                         | Acceptance target                                                           |
| -------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Overview       | Cards for services, power safety, machine plan, backups and observation time | All cards render authoritative values and link to details                   |
| Services       | List, status, adapter, dependencies, start/stop/restart and logs             | Reads and controlled mutations work for registered services                 |
| Schedules      | Weekly timeline, editor and preview                                          | Persistent schedule can be read, edited, validated, saved and reread        |
| Machine        | Read-only plan and weekly policy                                             | Clearly reports backend, effects, scheduler gates and next expectation      |
| Backups        | Targets, recent runs and mutation forms                                      | Read/run/schedule/retention operations expose clear state and errors        |
| Events         | History and operational lifecycle projections                                | Queries, integrity, retention and exports are usable without raw-shell work |
| Infrastructure | Security posture and route reconciliation                                    | Clearly distinguishes available from unavailable host diagnostics           |
| Settings       | Placeholder                                                                  | Remains labeled unavailable until a server-owned Settings API exists        |

The acceptance report must not state that all eight pages are complete. The
current source intentionally leaves Settings and parts of Infrastructure,
Backups, Events and next-transition UX partial.

## Browser acceptance scenarios

### Access boundary

1. An unauthenticated browser is challenged or redirected by Cloudflare
   Access and receives no administrative JSON.
2. An authenticated but unmapped principal receives Atlas `401`/`403`.
3. A mapped operator receives the dashboard shell and assets.
4. A principal lacking a specific permission sees the backend denial for that
   operation; the UI does not reinterpret it as success.
5. Host, origin, Fetch Metadata, content type, body-size and strict-JSON
   rejection tests remain green.

### Navigation and state

For every page, test initial loading, success, empty state, unavailable state,
busy/conflict, unauthorized and refresh after mutation. Test keyboard
navigation and narrow viewport behavior. The page must never retain stale
success after an API failure.

### Controlled mutations

Use a test registered service and test backup target. Verify exact operation
summary, confirmation, disabled in-flight control, terminal response, state
reread and matching audit records. Do not use machine shutdown, wake alarm or
the physical host as the first mutation test.

### Scheduling

Verify all four availability modes, canonical timezone, weekday validation,
invalid/reversed windows, preview, save, restart persistence and scheduler
consumption. When no persistent policy store is configured, the dashboard must
remain usable in read-only mode and must not offer a mutation that will 404.

## External and local evidence

Evidence should bind:

- source commit, bundle digest and dashboard asset digest;
- external hostname and Access application audience without tokens;
- HTTP status per scenario;
- enabled route count and catalog hash;
- screenshot or DOM snapshot for each page and error state;
- event-history attempt and terminal records for controlled mutations;
- confirmation that assertions, cookies and principal IDs are redacted.

## Non-goals

- disabling Cloudflare Access because Atlas also validates assertions;
- removing application RBAC after edge authentication;
- publishing port 3000;
- adding a second dashboard password;
- enabling physical power effects as part of dashboard acceptance.
