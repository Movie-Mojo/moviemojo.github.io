# Movie Mojo security audit

Audit date: October 11, 2026. Reviewed local application code, live Supabase policies/function definitions/grants/constraints, Supabase security advisors, and production HTTP headers. This is a focused audit, not a guarantee of absence of vulnerabilities. Production application code and settings were not changed.

## Confirmed findings

### 1. Medium: manual movie metadata is globally readable by verified accounts

`movies_read` allows every approved, email-confirmed user to read all rows in `public.movies`. A rollback test confirmed account B could read a manual title/description created for account A's private group even while B was correctly denied the group's records. Group membership, group names, suggestion notes, and profile details remain protected in the tested paths. This is a metadata confidentiality gap rather than exposure of entire watchlists.

Recommendation: separate shared TMDB metadata from private manual entries, or scope movie reads to authorized groups and explicit friend-history access. Review deduplication and friend-history behavior before changing the policy.

### 2. Medium: database validation can be bypassed through direct writes

The browser limits group names to 100 characters and manual titles to 200, and the group-creation RPC checks its name. However, authenticated users retain direct INSERT/UPDATE permissions on groups and INSERT on movies. A rollback test inserted a 1,000-character group name and a 1,000-character movie title with a 10,000-character description. Relevant database CHECK constraints are absent. This permits invalid/oversized content and contributes to storage abuse; it did not demonstrate SQL injection.

Recommendation: enforce nonblank names/titles, bounded lengths, valid movie IDs/years, and allowed poster URL hosts in database constraints or checked RPCs. Add sensible per-account quotas. Preserve existing rows by validating before migration.

Display names, suggestion notes, service selections, streaming regions, and numeric rating ranges already have database constraints.

### 3. Medium: PostgreSQL security updates are outstanding

Supabase's security advisor reports security patches are available for `supabase-postgres-17.4.1.064`. No specific exploit/CVE was independently reproduced.

Recommendation: back up and plan the Supabase upgrade, accounting for compatibility changes and downtime. [Upgrade guidance](https://supabase.com/docs/guides/platform/upgrading).

### 4. Medium: leaked-password protection is disabled

Confirmed by the live Supabase security advisor. Email verification does not prevent use of a previously compromised password.

Recommendation: enable leaked-password protection if supported by the project's plan and strengthen password requirements. [Password security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### 5. Low: unnecessary database privileges

The authenticated role has TRUNCATE, REFERENCES, and TRIGGER grants on application tables. TRUNCATE was confirmed with `has_table_privilege`; it was not executed. Row-level security does not limit TRUNCATE. No exposed HTTP/RPC route accepting arbitrary SQL was found, so this is excess privilege rather than a demonstrated remote wipe vulnerability.

Recommendation: revoke privileges the browser and checked RPCs do not require. Recheck table and column permissions afterward.

### 6. Low: browser security and dependency hardening

No Content-Security-Policy was present in production response headers or HTML. The pinned Supabase CDN script lacks Subresource Integrity. Successful XSS prevention currently relies heavily on correct escaping at every HTML insertion; persistent auth tokens are available to scripts on the origin.

Recommendation: add a tested CSP, remove inline event handlers as needed, and add SRI or self-host the pinned SDK. Escape provider image paths as well as user input, and allowlist external image/link origins. These are defense-in-depth improvements; user-input XSS was not reproduced in the tested surfaces.

### 7. Low: group invitation links cannot expire or be rotated independently

The invitation code is the group UUID itself. Knowing it is sufficient for a verified account to join, and the current implementation has no independent expiry/revocation token. This implements the requested anyone-with-the-link joining behavior, but leaked or old links continue to work. UUIDs are not practically guessable.

Recommendation: separate invite tokens from group IDs and offer rotation/revocation and optional expiry. Current members legitimately know the group ID; it should not also be the permanent invitation credential.

## Checks that passed

- RLS enabled on all nine application/private tables; no application views observed.
- Public browser key has the `anon` role; no service-role/secret key found in config.js. The TMDB key is intentionally visible in the static client, so it does not protect API quota from reuse.
- Inspected public RPC wrappers use invoker security; privileged implementations have an empty search_path and caller checks. Internal trigger functions are not granted to browser roles.
- Rollback tests: outsider group/list/profile denial; nonfriend watched-profile denial; self-approval denial; anonymous table/RPC denial; SQL-looking text remained literal data.
- Suggestion tests: group member names only; author-only note editing; non-author/direct update denial.
- Browser tests: malicious HTML in movie titles, notes, group names, and display names did not execute. Tests used mocked account data and did not write user payloads to production.
- Password-reset redirect targets are assembled from the current origin/path rather than user-supplied external URLs.
- Service worker does not cache cross-origin Supabase API responses.
- Private social tables with RLS and no policies are intentional: browser roles have no direct table grants and checked functions provide access. Their informational advisor notices do not indicate public exposure.

## Reproducible artifacts and limits

`tests/security-audit.sql` creates isolated generated fixture accounts and rolls back every write. It confirms both isolation checks and the two current data/validation findings. `tests/security-browser.cjs` uses mocked account/API data. Existing suggestion tests were run with the fixture email-confirmation update scoped to generated IDs.

One attempt to run the existing broader database-access suite failed with a connector request-state error; the independent audit suite above passed. No TRUNCATE/load tests, real-account takeover attempts, email sending, or production schema changes were performed. Full Auth settings, DNS/registrar permissions, recovery-email delivery, and dependency CVE enumeration were not independently verified. Current Supabase changelog and RLS documentation were consulted; an eventual upgrade needs its own compatibility review.

## Remediation update — October 11, 2026

Applied `database-security-fixes.sql`: movie metadata reads are now limited to the original contributor or members of groups containing the movie, new inserts require the caller as creator, and database constraints enforce name/title/description/comment bounds, numeric TMDB IDs, year range, and TMDB poster URLs. Existing records passed validation before migration. Friend watched-history access remains available through its checked RPC.

Share invitations now use separate random tokens with exactly seven days of validity. Expired tokens are replaced when generating another invitation; unexpired links keep their original expiry. Direct friend invitations expire seven days after sending. Permanent group UUIDs are no longer accepted as invitations, so old links/codes must be replaced. Verification after signup does not extend expiry.

Live rollback tests passed privacy, direct-write length limits, creator/group access, exact expiry, expired-link rejection, personal-list protection, direct invitation expiry, renewed tokens, and accepted-friend watched histories. Existing database access and suggestion suites passed with token-based invitations. Mobile browser tests passed including copied tokens and verified-signup continuation.

Per the user's request, browser/dependency hardening and excess database privileges were not changed. Leaked-password protection did not persist after saving and the dashboard says it requires Pro; PostgreSQL upgrade to stable 17.11.0.003 is prepared but requires an appropriate maintenance window (up to one hour offline, no downgrade). These platform items are pending, not fixed.
