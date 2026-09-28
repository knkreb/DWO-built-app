# Changelog

## v4.88 — Roles and Permissions, Slice 1: User Identity
Real login identity via `profiles` (keyed to `auth.users.id`, never email/name), admin-managed users (create, deactivate/reactivate, reset password, change email) with full audit trail, shared `alerts` center starting with tracker-ID-change alerts, and an Audit Log tab. See `docs/specs/slice-1-user-identity.md`.
- Fixed a CORS bug in admin-users: the Edge Function did not handle OPTIONS preflight requests, so every browser call to it (create user, reset password, deactivate, tracker ID, forced password change) silently failed with no error shown. Added CORS headers and OPTIONS handling; sb.invoke() now also resolves with a friendly error instead of an unhandled rejection on network failure.
