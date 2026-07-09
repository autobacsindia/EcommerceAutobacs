# Audit Summary

> ⚠️ **SUPERSEDED (2026-07-09):** A full re-audit after 121 commits lives in
> **[09-CONSOLIDATED-2026-07.md](09-CONSOLIDATED-2026-07.md)** (phases `01`–`08`).
> Current standing: **2 P1 (both latent, block go-live), 8 P2, 16 P3; no prod-reachable critical.**
> The findings below are the June baseline; several are resolved/reassigned in the refresh.

_Last updated: 2026-06-15 · Auditor: Claude Code · Status: PHASE 1–2 COMPLETE; roadmap awaiting sign-off_

> **Stack reality check:** Backend = **MongoDB/Mongoose + Express** on Railway (NOT SQL). Frontend = **Next.js 15 + React 19** on Railway. The prompt's Prisma+Neon and Vercel assumptions are evaluated — not assumed — in the ADRs.

## Master checklist
| # | Domain | File | Status | P0 | P1 | P2 | P3 |
|---|--------|------|--------|----|----|----|----|
| 0 | Inventory | [00-inventory.md](00-inventory.md) | ☑ | – | – | – | – |
| 1 | Git & repo | [10-git.md](10-git.md) | ☑ | 0 | 3 | 3 | 1 |
| 2 | Architecture | [20-architecture.md](20-architecture.md) | ☑ | 0 | 2 | 3 | 2 |
| 3 | Frontend | [30-frontend.md](30-frontend.md) | ☑ | 0 | 1 | 3 | 2 |
| 4 | Backend/API | [40-backend.md](40-backend.md) | ☑ | 0 | 2 | 3 | 1 |
| 5 | Database | [50-database.md](50-database.md) | ☑ | 0 | 2 | 3 | 1 |
| 6 | Infra/deploy | [60-infra.md](60-infra.md) | ☑ | 0 | 4 | 4 | 1 |
| 7 | Security | [70-security.md](70-security.md) | ☑ | 1 | 2 | 3 | 1 |
| 8 | Tooling/deps | [80-tooling.md](80-tooling.md) | ☑ | 0 | 0 | 4 | 2 |
| 9 | Testing | [90-testing.md](90-testing.md) | ☑ | 0 | 3 | 2 | 1 |
| 10 | Observability | [95-observability.md](95-observability.md) | ☑ | 0 | 1 | 3 | 1 |
| 11 | Docs/MD cleanup | [99-docs.md](99-docs.md) | ☑ | – | – | – | cleanup |
| 12 | ADRs | [adr/](adr/) | ☑ | – | – | – | – |

**Totals (approx):** P0 **1** · P1 **20** · P2 **31** · P3 **13**.

## Already fixed this session (on `develop`, commits `1957c901`, `3af702b0`)
- ✅ `develop` branch created + pushed.
- ✅ `.gitignore` UTF-16 → UTF-8 (ignore rules now work).
- ✅ `node_modules` untracked (9099 files); `Back-end/coverage/` untracked.
- ✅ Removed conflicting FE `railway.toml` + dead `Procfile`; removed broken `ci-tests.yml`; removed stray `frontend/`.
- ✅ ADR-001/002 written.

## Top 10 findings (by severity)
1. **[P0] S1 — Unrotated production secrets** after the historical `.env` exposure (Mongo/Atlas, SendGrid, Google×2, Google OAuth, Facebook, Cloudinary, **Twilio**, **Elasticsearch**). USER action via dashboards. → 70-security.md
2. **[P1] B1 — Unbounded queries:** 32 `.find()` with no pagination (only 3 controllers paginate). Perf + DoS risk. → 40-backend.md
3. **[P1] G3/I4 — No branch protection** on `main`/`develop`. USER (GitHub settings). → 10-git / 60-infra
4. **[P1] O1 — 611 `console.*`, no structured logger.** PII/secret leakage + unqueryable logs. → 95-observability.md
5. **[P1] Q1 — CI runs only a curated subset** of backend tests; full suite doesn't gate merges. → 90-testing.md
6. **[P1] D2 — Production indexes not yet ensured** (`ensure-production-indexes.js` unrun). USER/Railway. → 50-database.md
7. **[P1] Q3 — Guest-checkout e2e written but never executed** (revenue path). → 90-testing.md
8. **[P1] A2 — Backend root pollution:** hundreds of one-off scripts mixed into app root. → 20-architecture.md
9. **[P1] A1/B2 — God files:** import scripts 2400/2023 LOC, `routes/auth.js` 1256, `app.js` 945, admin edit page 1547. → 20/40
10. **[P1] S2/S3 — No `npm audit` / `gitleaks` in CI.** Dependency + secret scanning absent. → 70-security.md

## Architecture decisions
- **Frontend (Next.js + Vercel):** **MOVE FE to Vercel, keep BE on Railway.** Confidence **High**. → [adr-001](adr/adr-001-frontend-nextjs-vercel.md)
- **Database (Prisma + Neon):** **STAY on MongoDB/Atlas; do NOT move to Postgres now** (paradigm rewrite, money-path risk, Neon's serverless wins don't apply). Confidence **High**. → [adr-002](adr/adr-002-database-prisma-neon.md)
- **WP migration:** **Finish the strangler-fig (≈90% done); no big-bang.** Verify data parity + 301 redirects, then decommission WP. Confidence **High**. → [adr-003](adr/adr-003-wordpress-migration-strategy.md)
- **Environments/CI-CD:** `feature → develop → main`, per-env Railway services + Atlas DBs + secrets, branch protection. Confidence **High**. → [adr-004](adr/adr-004-environments-and-cicd.md)

---

## Remediation roadmap (plan only — STOP for sign-off before any Wave work)

Effort: S (<½ day) · M (~1–3 days) · L (>3 days).

### Wave 0 — Safety net
| Item | Effort | Risk | Deps |
|---|---|---|---|
| Rotate all prod secrets (S1) | M | high if skipped | USER dashboards |
| Branch protection on `main`/`develop` (G3/I4) | S | low | USER GitHub |
| Run `ensure-production-indexes.js` on prod (D2) | S | low | Railway auth |
| Add `npm audit` + `gitleaks` to CI (S2/S3) | S | low | – |
| Stand up `develop` Railway service + deploy + separate secrets (I1, adr-004) | M | med | branch ✅ |
| Run full backend suite in CI + reconcile coverage floor (Q1/Q2/I5) | S | low | – |
| Execute & gate guest-checkout e2e (Q3) | M | med | playwright install |

### Wave 1 — Structural cleanup
| Item | Effort | Risk | Deps |
|---|---|---|---|
| Move/delete backend root one-off scripts → `scripts/` (A2) | M | med | – |
| Split god files: `routes/auth.js`, `app.js`, import scripts, FE admin pages (A1/B2/F2) | L | med | tests first |
| Consolidate duplicate security + validation middleware (A3/A5/S7) | M | med | – |
| Add husky + lint-staged + Prettier; widen lint scope (T1/T2/T5) | S | low | – |
| Structured logging (pino) + PII redaction (O1/S5) | M | med | – |
| Docs consolidation 147 → ~15–20 (99-docs.md) | M | low | sign-off |
| Add pagination to list endpoints (B1) | M | med | – |

### Wave 2 — Architecture moves (execute approved ADRs)
| Item | Effort | Risk | Deps |
|---|---|---|---|
| Move FE to Vercel (Preview=develop, Prod=main); drop FE Dockerfile (adr-001) | M | med | adr-001 ✅ |
| Reduce `'use client'` over-use → Server Components (F1) | L | med | – |
| Per-env Atlas DB isolation (D5, adr-004) | S | low | – |
| Standardize Sentry SDK; verify env tags + sourcemaps (T3/O2) | S | low | – |

### Wave 3 — Data migration close-out
| Item | Effort | Risk | Deps |
|---|---|---|---|
| WP↔Mongo data-parity report (adr-003) | M | med | – |
| Old→new URL 301 redirect map + sitemap (SEO) | M | high | parity |
| Decommission WP + final backup; remove WP code/fields/deps (B4/D3/S4) | M | med | parity+redirects |

### Wave 4 — Hardening
| Item | Effort | Risk | Deps |
|---|---|---|---|
| Tests on money/auth/cart/inventory paths; raise coverage floor (Q5/Q2) | L | med | – |
| Uptime monitoring + alerting; metrics export (O3/O4) | M | low | – |
| Backend TypeScript / `@ts-check` migration (T-TS) | L | med | – |
| Perf pass: bundle analyze, CWV, query profiling (F-perf/B1) | M | low | – |
| Dependency upgrades: cloudinary v2, outdated majors (T) | M | med | audit |

## Open questions for the human
1. Confirm **Vercel** move for FE and **stay-on-Mongo** for DB (ADR-001/002 recommendations) — approve to schedule Wave 2.
2. Railway plan headroom for a **second `develop` backend service** within budget?
3. OK to **delete/move** backend root one-off scripts and consolidate 147 docs (Wave 1)?
4. OK to optionally **slim git history** of large binaries/old node_modules blobs (another history rewrite → re-clone)?
5. Confirm all collaborators have **re-cloned** after the prior `.env`/`mongodb-data` history rewrites.
