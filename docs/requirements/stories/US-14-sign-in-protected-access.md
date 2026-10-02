---
ID: US-14
Title: Sign in and access protected functions
Sprint: TBD
Status: done
Triggers: []
---

## Story

As an authorized user, I want to sign in and keep a secure application
session, so that I can use only protected functions available to my account.

## Acceptance criteria

- [x] The application provides an accessible email/password sign-in page and does not offer public registration
- [x] Valid credentials create a new opaque, revocable server-side session and return the authenticated user, active roles and effective permissions
- [x] Invalid email, password, inactive account, locked account and non-loginable legacy account all return the same generic credential failure
- [x] Passwords are protected with salted adaptive one-way hashing; submitted passwords are never trimmed, logged or stored in plaintext
- [x] The browser session uses a same-origin HttpOnly cookie with idle and absolute expiry, session-fixation protection and production Secure-cookie enforcement
- [x] Unsafe authenticated requests require approved-origin and CSRF validation, while repeated sign-in failures are rate limited
- [x] Refreshing the SPA restores a valid session without exposing the session token to JavaScript storage
- [x] Frontend protected routes redirect unauthenticated users to sign-in and preserve only an internal requested destination
- [x] Backend API routes are authenticated by default, with only an explicit public allowlist
- [x] Signing out revokes the current server-side session, clears the cookie and removes user-specific frontend state
- [x] Missing, expired, revoked or disabled-account sessions return 401; authenticated permission failures remain distinct 403 responses
- [x] Authentication and session outcomes create security events without recording credentials or raw tokens
- [x] Automated backend and frontend tests cover sign-in, session bootstrap, expiry/revocation, protected access, CSRF, sign-out and authentication errors

## Out of scope

Public registration; invitation email; password change or reset; MFA; SSO;
trusted devices; recent re-authentication; viewing or revoking other sessions.

## Notes

The approved implementation direction is a PostgreSQL-backed opaque session in
a same-origin HttpOnly cookie. Conforming ADRs remain pending because the
occurrence sources and `tools/records` generator referenced by the ADR workflow
are not present; generated files under `docs/views/` must not be edited by hand.
