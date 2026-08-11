# ADR-034 — CLI service-token identity

Status: Accepted

Supersedes nothing. Extends ADR-028 ("CLI identity and privilege boundary") and
ADR-031 ("Authenticated mutating CLI transport"), and narrows the identity
model those two established. Does not change the dashboard's authentication.

## Context

ADR-031 gave the CLI an authenticated transport by having it forward an
externally issued Cloudflare Access assertion in `ATLAS_CLOUDFLARE_ACCESS_JWT`.
That deliberately deferred the question of _whose_ identity a non-interactive
caller acts as: the only assertion an operator can obtain is their own, from
an interactive browser login.

The consequences of that deferral, all verified against the current source
before this decision was taken:

- **The CLI can only borrow a human identity.** Every action it takes is
  recorded as the operator whose browser session produced the assertion. A
  scheduled job, a CI step and a person typing at a terminal are
  indistinguishable in the event history.
- **`administrativePrincipalActorId` hard-coded `administrator:`.** The audit
  actor id was derived from the principal id alone, so there was no
  representation available for a non-human caller even if one could
  authenticate.
- **`createAdministrativePrincipal` required a canonical UUID.** Cloudflare's
  service-token assertion does not carry one: `sub` is empty and the caller is
  named by `common_name`, which holds the token's Client ID (`<hex>.access`).
  A service-token assertion was therefore _rejected outright_ — the feature was
  not merely unsupported, it was unreachable.
- **The assertion is short-lived.** An operator JWT expires within a day, so
  any automated use of the CLI required a human to periodically re-export a
  credential — the exact pressure that produces long-lived copies of human
  credentials in environment files.

Cloudflare Access already models this: a **service token** is a Client ID and
secret pair presented as `CF-Access-Client-Id` / `CF-Access-Client-Secret`.
Access validates the pair at its edge and issues the origin a signed assertion
of the same shape as an interactive login, distinguished only by claim content.

The capability being decided is narrow: let a non-interactive caller
authenticate **as itself**. It is an identity decision, not a new permission.

## Decision

### 1. Principals are discriminated by kind

`AdministrativePrincipal` carries `kind: "human" | "service"`. `kind` is
optional on construction and defaults to `human`, so configuration and role
assignments — which name a principal by id alone — are unchanged.

Only an authentication result that actually observed a service-token assertion
may assert `service`. The kind is never accepted from a caller, a request body
or a header.

### 2. The audit actor id is derived from the kind

`administrativePrincipalActorId` returns `administrator:<uuid>` for a human and
`service:<uuid>` for a service, and the event-history domain accepts both —
holding each to the same canonical principal-id check, because a prefix is not
evidence of identity.

A service identity can therefore never appear in the event history as a human
operator. "A person approved this" is exactly the claim an audit trail exists
to answer, and it must not be answerable by a machine.

### 3. Service tokens are declared, not discovered

`ADMINISTRATIVE_SERVICE_TOKEN_PRINCIPALS` maps each accepted Client ID to the
principal id it acts as:

```json
[{ "clientId": "<hex>.access", "principalId": "<uuid>" }]
```

Two consequences are intended:

- a service token that is not declared **authenticates as nobody**, even when
  Cloudflare accepted it. Reaching the origin is not authorization;
- a declared service token draws its roles from the ordinary
  `ADMINISTRATIVE_ROLE_ASSIGNMENTS` table, so RBAC keeps exactly one shape and
  one place to audit.

The **secret is never configured in this service** and never reaches this
process. Cloudflare validates it at the edge; the origin only ever sees the
resulting signed assertion.

Mapping to a configured UUID was chosen over widening the principal-id format
to accept Client IDs. The canonical-UUID rule is relied on by role assignment,
authorization decisions, the audit chain and the configuration contract;
relaxing it would loosen validation across all of them to serve one caller.

### 4. Claim shapes are matched exclusively, human first

A verified assertion resolves to at most one identity:

1. `sub` is a canonical UUID → human principal;
2. `sub` is empty **and** `common_name` is present **and** declared → service
   principal;
3. otherwise → unauthenticated.

`common_name` can never displace a real `sub`, so a service token cannot be
presented as an operator. Resolution happens only after signature verification,
so an unverified assertion never reaches the mapping. `common_name` is bounded
before it is used as a lookup key.

An assertion Cloudflare signed but this deployment does not recognise is an
**authentication** failure, not an authorization one: there is no principal to
authorize.

### 5. The CLI prefers a service token; the human assertion is deprecated

The CLI reads `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from the
environment and sends them in their own headers. `ATLAS_CLOUDFLARE_ACCESS_JWT`
remains as a deprecated fallback so existing workflows keep working.

A service token wins when both are present: a host configured for
non-interactive use must not act as whichever operator last exported a JWT.

**Half a service token fails closed.** Falling back to the human assertion
would silently reattribute every subsequent action to a person — the precise
confusion these two identities exist to prevent — and reporting nothing would
leave an operator debugging a 401 against a credential they believe is set.

The existing ADR-031 transport rules apply unchanged: credentials go only to an
HTTPS or loopback origin, redirects are never followed, no credential is
accepted as a command argument, and no credential value is logged, printed,
returned or embedded in an error.

### 6. The dashboard is untouched

Human operators continue to authenticate to the dashboard through Cloudflare
Access exactly as before. This ADR adds an identity; it removes none, and it
does not alter the dashboard's route policy, session handling or CSP.

## Consequences

- A non-interactive caller can authenticate as a durable, auditable identity of
  its own, without a human periodically re-exporting a personal credential.
- Reviewing "what did automation do" becomes a prefix filter on the event
  history rather than an inference from timing.
- An operator must now declare each service token before it can be used. This
  is deliberate friction: it is the step that makes the identity meaningful.
- `ADMINISTRATIVE_SERVICE_TOKEN_PRINCIPALS` is a second place where principal
  ids appear. A declared service token with no matching role assignment
  authenticates and is then denied everything — which is the correct failure,
  but reads as a permission bug unless both tables are checked.

## Alternatives rejected

- **Widening principal ids to accept Client IDs.** Relaxes a validation rule
  relied on by four subsystems to serve one caller.
- **Reusing `administrator:` for service tokens.** Cheapest to implement and
  the single most damaging option: it destroys the audit trail's ability to
  distinguish a person from a machine.
- **A CLI-managed credential of Atlas's own** (an API key table). Creates the
  second administration system ADR-031 exists to prevent, and moves credential
  validation from Cloudflare's edge into this process.
- **Dropping `ATLAS_CLOUDFLARE_ACCESS_JWT` immediately.** Would break the
  currently working operator workflow with no migration window.
