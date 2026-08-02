# Administrative security envelope

Administrative routes are closed by the project-owned route-security catalog.
Every route is loopback-bound, host/origin checked, assertion-authenticated,
role-authorized, bounded, and covered by fixed response headers. `trust proxy`
is false; forwarded headers are ignored. Browser-origin and Fetch Metadata
checks complement, but never replace, Cloudflare Access verification.

The application has no login session and the dashboard stores no assertion or
role data. Mutations require strict JSON and exact confirmations.
