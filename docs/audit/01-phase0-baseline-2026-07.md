# Phase 0 — Baseline & Scope (2026-07 audit refresh)

_Auditor: Claude Code · Date: 2026-07-09 · Mode: sequential/gated, findings-only._

Prior audit (`AUDIT_SUMMARY.md` + `10..99`) dates to **2026-06-15**. Since then **121 commits** landed on `main`, adding large high-risk surface. This phase re-scopes; Phases 1–8 re-verify prior findings and audit net-new code. **No product code changes in the audit; findings only.**

## Delta since last audit (2026-06-18 → 2026-07-09)

Major surface shipped (from git log):
- **Sales CRM + Leads** — new `leads` route/controller/model, admin CRM, lead sweep/sync services, backfill scripts. (money-adjacent: LTV, owner attribution)
- **Payment-status axis** on orders + admin Payment column; post-order/payment-status/order-status state clarity.
- **Post-delivery status + email sequences** — status-driven customer emails, review-request CTA.
- **Blog/journal section** + caching + on-demand revalidation routes (`/api/revalidate/home`).
- **ES search** hardening — cache-bust ordering, short-token fuzzy collisions, `q`/`search` param, synonym/category recall.
- **Full UI/UX revamp** across all pages (storefront theme rollout).
- **Auth** — session/token auth changes, auth fallback.

## Snapshot metrics (current `main`)

| Metric | Prior (Jun) | Now (Jul) | Note |
|---|---|---|---|
| Backend `npm audit` | unknown (no net) | **53 (1 crit, 15 high, 36 mod)** | Phase 7 triage |
| Frontend `npm audit` | unknown | **27 (2 high, 25 mod)** | incl. Next.js image-opt advisory |
| Backend route files | — | 40 | |
| Models | — | 34 | |
| Services | — | ~70 | grew substantially |
| Files with `console.*` (src, non-test/script) | 611 occ. | 121 files | still open (O1/S5) |
| Duplicate security middleware | flagged S7 | **still present** (`securityHardening.js` + `securityHardeningFinal.js` + `securityMiddleware.js`) | verify which is live |
| FE middleware | 2 files (1 dead) | **1 file** `src/middleware.ts` | dead one removed ✓ |

## Prior findings — reconciliation (status to VERIFY in each phase)

| ID | Prior sev | Finding | Phase 0 status | Re-verify in |
|---|---|---|---|---|
| S1 | P0 | Unrotated prod secrets post `.env` exposure | **VERIFY w/ user** — dashboard action, cannot confirm from code | Phase 1 |
| B1 | P1 | 32 unbounded `.find()` (DoS/perf) | Open — re-count on grown surface | Phase 3 |
| G3/I4 | P1 | No branch protection on main/develop | VERIFY (GitHub settings) | Phase 6 |
| O1/S5 | P1 | 611 `console.*`, no structured logger | Open — 121 files still log | Phase 6 |
| Q1 | P1 | CI runs only curated test subset | Open — confirm gating | Phase 6 |
| D2 | P1 | Prod indexes (`ensure-production-indexes.js`) unrun | VERIFY (prod) | Phase 4 |
| Q3 | P1 | Guest-checkout e2e written, never executed | Open | Testing phase |
| S2/S3 | P1 | No `npm audit`/`gitleaks` in CI | Open — now have counts (53+27) | Phase 6/7 |
| S7/A3 | P3 | Duplicate security middleware | **Still present** | Phase 1 |

## New scope added this refresh (not in June audit)
- **Phase 2 (new): Payments/pricing/money integrity** — coupon+karma engine, `pricingService` paise math, sale-countdown revert, invoice idempotency, refund/return → `totalSpentPaise` (known-unwired per project memory).
- **Sales CRM / Leads** authZ + IDOR + dedup correctness (Phase 1 + 3).
- **ES search** sync/cache correctness (Phase 3).
- **Blog + revalidation routes** — cache poisoning surface (Phase 3/5).

## Env posture (user confirmed: `.env` == prod values; only prod envs exist)

Inspected `Back-end/server/.env` (key names + non-secret shapes only; no values printed).

| Finding | Sev | Evidence | Impact |
|---|---|---|---|
| **ENV1 — No dev/prod data isolation** | **P0 (blocks testing)** | `NODE_ENV=development` but `MONGO_URI=…cluster0.uavmin7.mongodb.net/autobacs` (prod cluster); `FRONTEND_URL=localhost:3000` | Local dev + the upcoming test phase write to **production data**. Contradicts CLAUDE.md dev-isolation contract. Must provision a separate dev/staging DB before test execution. |
| ENV2 — Razorpay in test mode | ✅ ok | `RAZORPAY_KEY_ID=rzp_test_*` | Payment testing is safe; no live charges. |
| ENV3 — Local `.env` missing prod keys | P2 (test fidelity) | 22 keys only; no Postmark/email, `ELASTICSEARCH_*`, `QUEUE_REDIS_URL`, `SENTRY_DSN`, `COOKIE_DOMAIN`, `FRONTEND_URLS`, `COMPANY_*` | Local runs hit fallback paths (no email/ES/queue-split/Sentry) → tests don't reflect prod behavior. |
| ENV4 — `REDIS_URL` non-TLS | P3 (verify) | scheme is `redis://` not `rediss://` | Likely local Redis; confirm prod uses `rediss://` Upstash and preflight is env-gated. |
| ENV5 — `RESET_TOKEN_SECRET ` trailing space in key | P3 | line 25: `RESET_TOKEN_SECRET =` | dotenv likely trims, but fragile; verify the var is actually resolved where read. |
| ENV6 — `railway.json` (FE) tracked with buildArgs | P3 (info) | `NEXT_PUBLIC_API_URL` + `phc_*` PostHog key committed | Public by design (`NEXT_PUBLIC_*`); not a secret leak. Note `NEXT_PUBLIC_API_URL` hardcoded here must change at cutover. |

**S1 (June P0 — secret rotation): RESOLVED per user — all leaked credentials rotated** after the exposure. Phase 1 residual task: grep code/history for any lingering *old* key references (no functional impact, hygiene only). Downgraded from P0.

**ENV1 (isolation): decision deferred to testing phase per user.** Audit stays read-only (safe against prod). Hard gate: no automated/manual **write** tests run until a dev/staging DB is provisioned. Re-raise before test execution.

## Exit criteria for Phase 0
- [x] Delta computed, metrics snapshotted, prior findings mapped to phases.
- [x] npm audit counts captured for Phase 7.
- [x] Env posture assessed → **ENV1 (P0) surfaced: no dev/prod isolation.**
- [ ] **DECISION: provision a dev/staging DB before test execution** (blocks testing phase, not Phase 1 audit).
- [ ] **User to confirm S1**: were the leaked credentials rotated (new values generated) after the `.env` history exposure?
