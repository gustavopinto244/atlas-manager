# Security policy

Atlas Manager administrative HTTP is loopback-only and requires Cloudflare
Access verification followed by application authorization. Reports and browser
code never contain assertions, credentials, or private paths. Please report
security issues privately to the project owner; do not include secrets or
production event data in an issue.

The `1.0.0-rc.7` candidate retains strict public-origin authority validation,
same-origin browser-context checks, a closed administrative route catalog, and
fail-closed managed persistence checks. It is a software release candidate,
not evidence of a qualified physical Atlas host, real Cloudflare ingress,
helper activation, RTC wake behavior, or real shutdown behavior.
