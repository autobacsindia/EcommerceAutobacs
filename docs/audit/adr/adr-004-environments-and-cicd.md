# ADR-004 — Environments & CI/CD (develop / main)

_Status: Proposed · Date: 2026-06-15 · Auditor: Claude Code_

## Context
Goal: two long-lived environments, `develop` (test everything) and `main` (production), mirrored across every platform. Phase 0 reality:
- Only `main` existed (✅ `develop` created + pushed this session).
- Deploy (`deploy.yml`) triggers on `main` only; no `develop` deploy target.
- FE had conflicting Railway config (✅ fixed); `ci-tests.yml` broken/dupe (✅ deleted).
- No branch protection (USER action). Per ADR-001 the frontend should move to Vercel; per ADR-002 the DB stays on Mongo/Atlas.

## Decision — promotion flow
```
feature/* ──PR──▶ develop ──(verify on develop env)──▶ PR ──▶ main (production)
```
- All work branches off `develop`; PRs into `develop` run CI; merge auto-deploys to the **develop** environment.
- Promotion to production = PR `develop → main`; merge runs `deploy.yml` to **prod**.

## Environment mapping
| Layer | develop | main (prod) |
|---|---|---|
| Backend (Railway) | `backend-develop` service, own env vars | `backend` service (exists) |
| Frontend (Vercel, ADR-001) | Preview/`develop` deployment | Production deployment |
| Database (Atlas, ADR-002) | separate `…-develop` DB/cluster | prod DB/cluster |
| Redis / Elasticsearch | per-env instances | prod instances |
| Sentry | `environment=develop` tag | `environment=production` tag |

## CI/CD changes required (roadmap Wave 0)
1. **Branch protection** on `main` *and* `develop`: require PR + green `ci.yml`/`ci-frontend.yml`, block force-push to `main`. (USER — GitHub settings.)
2. **`develop` deploy:** extend `deploy.yml` (or add a workflow) to deploy backend to the Railway `develop` service on push to `develop`; add the `RAILWAY_*_DEVELOP` service secrets.
3. **Vercel** (post ADR-001): wire Production→`main`, Preview→`develop` + per-PR previews.
4. **Secret separation:** distinct secret sets per env in Railway/Vercel/Atlas; never reuse prod secrets in develop. Pairs with the pending rotation (S1).
5. **Run full backend test suite in CI** (Q1) and reconcile the coverage-floor mismatch (Q2/I5).

## Recommendation
Adopt the `feature → develop → main` flow above with per-env services and isolated secrets. Lowest-friction path: keep backend on Railway (two services), move frontend to Vercel (native preview-per-PR), separate Atlas DB per env.

## Confidence: **High.**
What would raise it: confirmation of Railway plan limits (can it host a second `develop` backend service within budget?) and the Vercel migration timing relative to standing up the `develop` backend.
