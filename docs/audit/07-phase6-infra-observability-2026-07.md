# Phase 6 — Infra, Deploy & Observability (2026-07)

_Auditor: Claude Code · Date: 2026-07-09 · Read-only, findings only._

**Verdict: good runtime resilience (queues, Sentry, Redis fail-fast) but a weak deploy gate and logging gap.** This phase carries the audit's **second P1** (effective CI gate) plus two P2s.

## Verified strengths (evidence)

| Area | Evidence | Status |
|---|---|---|
| Queue resilience | `queue/queues.js`: `attempts:3` (5 for critical), exponential backoff, `removeOnFail:{age:7d}` (inspectable DLQ) | ✅ prod-grade |
| Sentry | `initSentry()` at boot; warns (not crashes) if `SENTRY_DSN` missing in prod; env-validated | ✅ |
| Redis fail-fast | `server.js:182-202` prod preflight: exits if `REDIS_URL` unreachable/missing; TLS auto-detected from `rediss://` | ✅ intentional (see note) |
| CI structure | `ci-frontend.yml` lint→test→build ordered; both apps run in CI | ✅ (but see INFRA-1) |

## Findings

| ID | Sev | Evidence | Issue | Fix |
|----|-----|----------|-------|-----|
| **INFRA-1** | **P1** | `ci.yml:71` `--testPathPatterns="orderStatusService\|...\|couponKarmaIntegration"` (7 patterns); `ci-frontend.yml:78` "curated, passing suite set (jest.ci.config.js quarantines…)"; no `deploy.yml`; `ci-frontend.yml:13` "required by branch protection on main"; git log = direct-to-main commits | **Effective prod deploy gate is weak.** (1) Both apps gate on **curated test subsets** — full suites are quarantined (flaky: mock leakage + test-DB isolation, per project memory), so regressions outside the 7 patterns don't fail CI, and the 60% coverage floor only measures the subset. (2) Railway + Vercel **auto-deploy on push to `main`**; CI only blocks if **branch protection** is enforced with required checks — and the commit history (casual messages, no merge commits, direct on main) suggests it may not be. → An ungated commit can reach production. | (a) **Verify + enforce branch protection** on `main`: require both CI checks, require PRs, block direct pushes. (b) **Stabilize the full suites** (fix mock leakage + per-test DB isolation) and gate CI on all tests, not the curated subset. Merges June **Q1 + G3/I4**. |
| **OBS-1** | **P2** | 121 backend files use raw `console.*`; no `pino`/`winston`/logger util found | **No structured logging.** Unqueryable logs, no correlation IDs in aggregation, and PII/token leak risk (error middleware already sanitizes its own logs, but ad-hoc `console.*` across services does not). | Introduce `pino` with a **redaction** allowlist (auth headers, tokens, emails, card/UPI fragments); replace `console.*` in `services/`, `controllers/`, `middleware/`. Wire request-id into log context. Merges June **O1**. |
| **CI-1** | **P2** | No `gitleaks`/`npm audit`/`osv`/`snyk` in `.github/workflows/` | **No security scanning in CI.** The 53 BE + 27 FE dependency vulns (Phase 7) and any future secret commit go undetected by the pipeline. | Add a `gitleaks` job + `npm audit --audit-level=high` (or `osv-scanner`) gate on both apps. Merges June **S2/S3**. |
| DOCS-1 | P3 | root `CLAUDE.md` references `deploy.yml` (Railway test-gated deploy) — **file does not exist** | Docs drift: deployment is actually **platform auto-deploy** (Railway/Vercel on `main` push), not a GH Actions deploy. Misleads on how gating works (see INFRA-1). | Correct `CLAUDE.md` CI/deploy section; document the real gate (branch protection + platform auto-deploy). |

## Note — Redis fail-fast (deliberate, low priority)
`server.js` hard-exits in production if Redis is unreachable at boot (no degraded mode). This is a documented choice (project memory), but means a transient Redis outage = failed boot / restart loop (Railway `restartPolicyMaxRetries:10`). Contrast with the app's Mongo-fallback resilience elsewhere. **Also interacts with PAY-1**: since the preflight only runs at boot, the webhook's `redisClient.quit()` kills Redis *post-boot* → the app keeps running but every Redis op fails until restart. Reinforces PAY-1's severity. Consider a degraded-mode option (serve without cache/rate-limit) vs. hard-exit. **P3.**

## Deferred / not verified (cannot check from code)
- **Branch protection actual state** — GitHub setting; INFRA-1 assumes worst case from commit patterns. **Verify in GitHub → Settings → Branches.**
- Railway/Vercel deploy env parity vs `.env.example` contract → cross-check at cutover (RUNBOOK).
- Healthcheck behavior under Redis-down (`/health` vs `/api/warmup`) — trace in testing.

## Exit criteria
- [x] CI gating model + curated-subset gap identified (INFRA-1).
- [x] Logging gap confirmed (OBS-1); no CI security scan (CI-1).
- [x] Queue/Sentry/Redis resilience verified.
- [ ] INFRA-1 (P1) + OBS-1/CI-1 (P2) → fix backlog; **verify branch protection**.
