# Atlas Manager manual backups

The protected route `POST /admin/backups/targets/:targetId/runs` runs one
registered target after Cloudflare authentication, fixed-role authorization,
and the exact confirmation `confirm_registered_backup_run`.

The coordinator persists a started run before invoking one approved adapter.
Successful artifacts are atomically published and checksummed. Terminal run
metadata and administrative audit events follow the effect. No retry is
performed. An interrupted or state-recheck result requires operator review.

Backup contents, paths, manifests, and source details are never returned by the
API or dashboard.
