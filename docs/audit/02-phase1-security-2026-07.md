# Phase 1 — Security (2026-07 audit refresh)

_Auditor: Claude Code · Date: 2026-07-09 · Read-only, findings only._

**Verdict: strong security posture** — confirms the June assessment. Core hardening is correctly mounted, authZ is consistently enforced (owner-or-admin), the new CRM surface is admin-gated, uploads are defended, JWT is locked. Findings are **hygiene-grade (P3)**; no P0/P1 introduced.

## Verified strengths (evidence)

| Area | Evidence | Status |
|---|---|---|
| Core hardening mounted | `app.js`: cspNonce→helmet→csrf→CORS-allowlist→json(500kb)→mongoSanitize→rate limits | ✅ inline, not via the dead files |
| Webhook integrity | `app.js:610-619` Razorpay `express.raw` mounted **before** csrf + json (signature over raw body) | ✅ correct order |
| Order authZ (IDOR) | `orderController.js:82-83, 509, 552, 589` — every read/update/cancel/delete checks `isOwner \|\| isAdmin` | ✅ no IDOR |
| Sales CRM / Leads | `routes/leads.js`: `router.use(protect, admin)` on whole router + `adminRouteRateLimit` mount + bulk-before-`:id` ordering | ✅ admin-only, PII protected |
| File uploads | `uploadMiddleware.js`: MIME allowlist + **magic-byte verification** (anti content-type spoof) + `fileSize` limit; routes `products.js:323/338/376` all `protect, admin` | ✅ hardened |
| JWT | `jwtSecretManager.js`: `algorithms:['HS256']` locked (anti alg-confusion) + key rotation (`verifyTokenWithRotation`) | ✅ senior-grade |
| Debug endpoint | `app.js:913` mount wrapped in `if (NODE_ENV !== 'production')` | ✅ not exposed in prod |

## Findings

| ID | Sev | File | Issue | Fix |
|----|-----|------|-------|-----|
| SEC-1 | P3 | `middleware/securityHardening.js`, `securityHardeningFinal.js`, `securityMiddleware.js` | **Dead code** — none mounted in `app.js` (real hardening is inline). Risk: false sense of coverage; someone may "fix" security by editing a file that never runs. | Delete all three (or document as unused). Confirms June S7/A3. |
| SEC-2 | P3 | `routes/debug.js` | `/debug/env` returns WP API key **prefix + length + set-flags**. Env-gated to non-prod so **not exposed in prod**. But local `NODE_ENV=development` points at **prod** WP creds (see ENV1), so running locally surfaces prod key metadata on localhost. | Reduce payload to booleans only, or delete the route. Low urgency. |
| SEC-3 | P3 | `utils/tokenUtils.js:24` | `RESET_TOKEN_SECRET \|\| 'default-pepper-change-in-production'` — **fail-open** to a repo-known pepper. Practical risk LOW (token is 256-bit random, SHA-256'd; pepper is defense-in-depth only). Compounded by `.env` key having a **trailing space** (`RESET_TOKEN_SECRET =`; dotenv trims so local works, but a trailing space in the Railway var would silently drop to the default). | (a) Remove trailing space in `.env`; (b) verify Railway var name is exact; (c) make it **fail-closed in production** (throw if unset) instead of silent default. |

## Reassigned to later phases (already tracked, not security-owned)
- `console.*` PII-leak risk (121 files) → **Phase 6** (observability/logging).
- Unbounded `.find()` DoS vector → **Phase 3** (backend).
- 53 BE + 27 FE npm vulns (1 crit / 17 high) → **Phase 7** (deps).
- No `gitleaks`/`npm audit` gate in CI → **Phase 6** (CI).
- WP-import SSRF (outbound to Woo REST) → **Phase 3** (verify URL validation).

## Deferred / not yet verified in Phase 1 (limitations)
- CSRF exemption list correctness (global mount seen; per-route exemptions unaudited).
- Actual JWT access/refresh **expiry values** + refresh-token revocation on logout.
- Password-reset + email-verification **flow-level** replay/rate-limit (token single-use enforcement) — spot-check in Phase 3.
- Rate-limit thresholds tuned vs bypassable (adaptive throttling profile).

## Exit criteria
- [x] AuthZ coverage verified on high-value + new surfaces (orders, leads, uploads).
- [x] Core hardening + webhook + JWT verified.
- [x] S1 (secrets) closed per user (rotated).
- [ ] SEC-1/2/3 → fix backlog (P3, batch with fix pass).
