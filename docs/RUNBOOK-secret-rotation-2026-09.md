# Runbook: credential exposure & rotation — September 2026

Record of the audit run on 2026-09-12, what was rotated, how each item was
verified, and what is still open. Written because the previous attempt at this
(`Back-end/server/SECRETS_ROTATION_GUIDE.md`) pasted every secret it was telling
you to rotate into a file that then went public.

## Why this happened

The repository was made **public** during a GitHub billing lapse and stayed that
way. Everything below had been sitting in public history since then.

## The rule that governs all of it

**Removing a secret from git does not un-leak it. Revoking it at the provider is
the only fix.**

Concretely, on 2026-09-12 these three commits were verified as *unreachable from
any branch* — a full `git clone` does not fetch them — and GitHub was still
serving their `Back-end/server/.env` blobs on request:

| commit | in a clone | served by GitHub API |
|---|---|---|
| `19a07771` | absent | 142 bytes |
| `15494919` | absent | 380 bytes |
| `815a0bd4` | absent | 353 bytes |

GitHub retains unreachable objects and serves them by SHA indefinitely. Push
event SHAs are public via the Events API and permanently archived by GH Archive,
so the identifiers are discoverable. **A history rewrite cannot remove these** —
they are already unreachable. Purging them requires a GitHub Support request to
force a GC, or deleting the repository.

Corollary: never `git push --force` to `main` for this purpose. It is the
production deploy, it bypasses the PR + CI gate, and it does not achieve the
goal.

## What leaked

Two scanners were needed; neither was sufficient alone.

- **gitleaks** (full history): 32 findings, 2 of them false positives.
- **GitHub secret scanning**: 13 alerts, oldest 2025-11-18, none ever triaged —
  including 5 MongoDB URIs that gitleaks did not flag at all.

`SECRETS_ROTATION_GUIDE.md` held **8 plaintext values** under `**Current**:`.
Most were invisible to both scanners: a JWT secret, a Cloudinary secret and a
Facebook app secret are bare high-entropy strings with no recognisable prefix, so
pattern matchers never fire. **A document that lists secrets defeats secret
scanning by construction.** The fix is to delete the values, not tune the scanner.

## Status

| Credential | Status | How it was verified |
|---|---|---|
| Google OAuth client secret | ✅ rotated | Old client returns `Error 401 / deleted_client` from Google. Prod serves a new client id; Google renders a normal sign-in page and accepts the callback URI. |
| MongoDB `cluster0.t4njob6` | ✅ cluster deleted | No SRV record for `_mongodb._tcp` — Atlas tears down DNS on delete. |
| MongoDB Atlas API keys | ✅ rotated | Leaked value absent from live config. |
| JWT secret | ✅ rotated | Leaked value absent from live config. |
| Cloudinary API secret | ✅ rotated | Leaked value differs from live. |
| WooCommerce `ck_`/`cs_` | ✅ rotated in WP-Admin | Operator-confirmed; not verifiable from outside (WP host returns 403 post-cutover). |
| SendGrid API key | ✅ retired | No `@sendgrid` dependency; `postmark` is the mail provider. |
| Google Maps API key | ✅ unused | Only `maps.google.com` / `maps.googleapis.com` allowlist strings; no key is passed. |
| MongoDB `cluster0.uavmin7` | ⏳ pending delete | DNS still resolves to 3 live nodes in `ap-southeast-1`. Referenced by no code and by neither `.env`. |
| Facebook app secret | ⏳ open | Still plaintext in `HEAD`. Referenced by **no code** — confirm the app is dead, or rotate. |

### Verifying an Atlas cluster is really gone

DNS, not a connection attempt. Atlas blocks non-allowlisted IPs at the network
layer, so a TCP probe fails against a *healthy* cluster too and proves nothing.

```bash
dig +short SRV _mongodb._tcp.<cluster>.mongodb.net @8.8.8.8
# no output  → deleted
# 3 records  → still exists (note: a PAUSED cluster keeps its DNS)
```

### Verifying an OAuth client is really gone

No credentials required — the client id alone is enough.

```bash
curl -sL -A 'Mozilla/5.0' \
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=<OLD_ID>&redirect_uri=<URI>&response_type=code&scope=openid%20email" \
  | grep -oE 'deleted_client|invalid_client|<title>[^<]*</title>'
# deleted_client            → client is gone, its secret is worthless
# "Sign in - Google Accounts" → client still exists
```

⚠️ This only exercises the **authorization** leg. The client secret is used in
the token exchange, after consent — a wrong secret still renders the sign-in page
and then fails at the callback. Only one real end-to-end login proves the secret.

## Still open

- Delete the `cluster0.uavmin7` cluster. Check **every Atlas project and org**,
  not just the one holding `autobacs-prod` — it may not be in an org you control.
  Before deleting: if Network Access is `0.0.0.0/0`, that was the live exposure.
- Resolve the Facebook app secret.
- Local `Back-end/server/.env` still holds the **deleted** Google client and the
  **old** WooCommerce key, and `WORDPRESS_SITE_URL` points at a host that now
  returns 403. Local Google login is broken until this is updated.
- Close the 13 GitHub secret-scanning alerts as **Revoked**.
- Confirm `POSTMARK_SERVER_TOKEN` / `POSTMARK_FROM_EMAIL` are set on Railway.

## Prevention

- A rotation runbook names the **variable**, never the value.
- `.gitleaksignore` is for verified false positives only. A real secret is
  rotated, never suppressed.
- Push protection is enabled — keep it on; it is why nothing new has landed.
- Enable **secret scanning validity checks** so GitHub reports which flagged
  credentials are still live.
