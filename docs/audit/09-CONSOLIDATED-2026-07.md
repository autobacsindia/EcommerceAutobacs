# Audit Consolidation & Fix Backlog — 2026-07 Refresh

_Auditor: Claude Code · Date: 2026-07-09 · Mode: sequential/gated, findings-only (no product code changed)._

Refreshes the June 2026 audit (`AUDIT_SUMMARY.md`) after **121 commits** added the highest-risk surface (Sales CRM/leads, coupon+karma money engine, payment-status axis, email sequences, ES search, full UI revamp).

## Headline

**The codebase is in notably good health.** Security is strong (no IDOR, locked JWT, hardened uploads, sanitized XSS surfaces), money math is server-authoritative and atomic, and the data model is durable. The real risks are **2 P1s** (both *latent* — they bite at go-live, not today) and a cluster of P2s around operability. After reachability triage, **there is no production-reachable critical dependency vuln**.

## Master checklist (2026-07)

| Phase | Doc | P0 | P1 | P2 | P3 | Verdict |
|---|---|----|----|----|----|---------|
| 0 Baseline | [01](01-phase0-baseline-2026-07.md) | (1 gate) | – | – | – | env isolation gap surfaced |
| 1 Security | [02](02-phase1-security-2026-07.md) | 0 | 0 | 0 | 3 | strong |
| 2 Payments/Money | [03](03-phase2-payments-money-2026-07.md) | 0 | 1 | 1 | 1 | strong; 1 latent P1 |
| 3 Backend | [04](04-phase3-backend-2026-07.md) | 0 | 0 | 0 | 4 | good |
| 4 Database | [05](05-phase4-database-2026-07.md) | 0 | 0 | 0 | 2 | durable |
| 5 Frontend | [06](06-phase5-frontend-2026-07.md) | 0 | 0 | 1 | 2 | solid |
| 6 Infra/Obs | [07](07-phase6-infra-observability-2026-07.md) | 0 | 1 | 2 | 2 | weak deploy gate |
| 7 Dependencies | [08](08-phase7-dependencies-2026-07.md) | 0 | 0 | 3 | 2 | overstated by raw counts |
| **Totals** | | **0** | **2** | **8** | **16** | |

## Prioritized fix backlog

### 🔴 P1 — fix before go-live (block cutover)
| ID | Fix | Effort | Owner | Gate |
|----|-----|--------|-------|------|
| **PAY-1** | Remove `redisClient.quit()` in `middleware/razorpayWebhook.js` (kills the shared singleton; first live webhook tears down app Redis). Add regression test: Redis still connected after a webhook. | S | Dev | **Blocks live payments** |
| **INFRA-1** | (a) Enforce branch protection on `main` (required CI checks, PR-only, no direct push). (b) De-flake full test suites (mock leakage + per-test DB isolation) and gate CI on all tests, not the 7 curated patterns. | M–L | Dev + Ops | **Blocks trusting CI** |

### 🟠 P2 — fix this cycle
| ID | Fix | Effort |
|----|-----|--------|
| PAY-2 | Subtract `totalSpentPaise` + decrement `paidOrderCount` on refund/return/cancel (in the refund txn, floor at 0) + a reconcile job | M |
| FE-1 | Make `/api/revalidate/{home,warehouses}` **fail-closed** in prod; set `REVALIDATE_SECRET` in Vercel/Railway | S |
| OBS-1 | Introduce `pino` + redaction; replace 121 files' `console.*`; wire request-id | L |
| CI-1 | Add `gitleaks` + `npm audit --audit-level=high` gate to both CI workflows | S |
| DEP-1a/b | `npm audit fix` (non-breaking) → mongoose ($nor NoSQLi), next (image-opt CVE) | S |
| DEP-1c | `cloudinary` v1→v2 (breaking) in its own PR; migrate uploader calls; test upload+magic-byte flow | M |

### 🟡 P3 — hygiene / hardening (batch)
| ID | Fix |
|----|-----|
| SEC-1 | Delete 3 dead security-middleware files (`securityHardening*.js`, `securityMiddleware.js`) |
| SEC-2 | Reduce `/debug/env` to booleans or remove |
| SEC-3 | `RESET_TOKEN_SECRET`: fix `.env` trailing space, verify prod var, fail-closed in prod |
| BE-1 | Add failure metric/alert + reconcile job for ES sync & cache invalidation |
| BE-2 | Atomic `findOneAndUpdate` claim for invoice/status/review email idempotency |
| BE-3/4 | Cap the two uncapped `.find()` limits |
| DB-1 | Add `lowercase:true,trim:true` to `User.email` (+ backfill-normalize first) |
| DB-2 | Gate `autoIndex` to non-prod / background-build new indexes |
| FE-2 | Remove dead `localStorage.getItem('authToken')` fallbacks |
| FE-3 | Server-side sanitize blog HTML (`sanitize-html`) for SSR/SEO |
| DEP-2 | Isolate/remove `artillery` → drops the "critical" from reports |
| DOCS-1 | Fix `CLAUDE.md` (no `deploy.yml`; platform auto-deploy) |
| — | Consider Redis degraded-mode vs hard-exit at boot |

## USER / Ops action items (cannot fix from code)
- [ ] **Verify branch protection** on `main` (INFRA-1 assumed worst-case).
- [ ] **Provision a dev/staging DB** before test execution (ENV1 — the testing gate).
- [ ] **Set `REVALIDATE_SECRET`** in Vercel + Railway (FE-1).
- [ ] **Restrict `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** by HTTP referrer in Google Cloud.
- [x] Secrets rotated after historical `.env` exposure (confirmed — June S1 closed).

## Gate before the TESTING phase (hard prerequisites)
1. **ENV1** — stand up an isolated dev/staging Mongo + dev `.env`. **No write tests run against prod data.** Local `.env` currently has `NODE_ENV=development` → **prod** `MONGO_URI`.
2. **PAY-1** — fix first; it's a payment-path defect and the webhook is a core test target.
3. Backfill the local `.env` with the prod-parity keys it's missing (Postmark, ES, `QUEUE_REDIS_URL`, Sentry) so tests exercise real paths, not fallbacks (ENV3).

## Handoff → Testing phase (automated + manual)
Priority order, once the gate above is cleared:
1. **De-flake + full-gate the suites** (INFRA-1) — foundation for everything else.
2. **Unit:** `pricingService` (paise math, karma trim, coupon caps), coupon atomic guard, karma clawback.
3. **Integration:** Razorpay webhook (signature, amount-mismatch reject, replay dedup, **Redis-still-up after** — PAY-1 regression), order state machine, refund→LTV (PAY-2 regression).
4. **E2E:** execute the **guest-checkout e2e that was written but never run** (June Q3); register→cart→checkout→pay→invoice→return.
5. **Manual smoke** on staging: the same journey + admin CRM/leads + offline-order entry.
