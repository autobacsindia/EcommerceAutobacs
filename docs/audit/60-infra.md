# 60 — Deployment & Infrastructure

_Phase 1. Both apps currently on **Railway** (Docker). CI/CD via GitHub Actions._

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| I1 | P1 | Only `main` existed; `deploy.yml` triggers `on: push: [main]` only | No `develop` deploy environment → no environment parity | ✅ `develop` branch created; **still need** a Railway `develop` service + deploy trigger for it |
| I2 | P1 | FE had both `railway.json` (health `/api/warmup`) **and** `railway.toml` (health `/api/health`, `startCommand node server.js`) + a stale `Procfile` | Conflicting/duplicate deploy config; ambiguous source of truth | ✅ FIXED — removed `railway.toml` + `Procfile`; `railway.json` is sole source; Dockerfile `CMD node server.js` (Next standalone) is correct |
| I3 | P1 | `ci-tests.yml` referenced nonexistent `Autobacs/Back-end/server/...`; duplicated `ci.yml` | Broken + duplicate backend CI workflow | ✅ FIXED — deleted; `ci.yml` is authoritative backend CI |
| I4 | P1 | Repo settings | No branch protection / required checks before deploy to `main` | **USER ACTION** — require green CI + PR review on `main` |
| I5 | P2 | `ci.yml` comment says "60% coverage floor"; `jest.config.js` `coverageThreshold` = lines/functions/statements **55**, branches **45** | CI doc contradicts enforced thresholds | Reconcile comment vs config; pick one number |
| I6 | P2 | Backend has `Dockerfile` + `Dockerfile.v2` + unused `nixpacks.toml` (railway.toml selects DOCKERFILE) | Multiple/dead build configs | Delete `Dockerfile.v2` + `nixpacks.toml` after confirming the active path |
| I7 | P2 | No `.nvmrc`; `engines.node >=20.9` only | Local Node version unpinned across dev/CI/Railway | Add `.nvmrc` (20.x) to both apps for parity |
| I8 | P2 | Secrets live in Railway env; rotation pending (prior memory) | Several prod credentials not yet rotated | **USER ACTION** — rotate MONGO_URI, Atlas keys, SendGrid, Google (2), Google OAuth, Facebook, Cloudinary, Twilio, Elasticsearch |
| I9 | P3 | No documented rollback strategy | Rollback is implicit (redeploy previous) | Document Railway rollback + DB backup-before-migration runbook |

## Environment parity (target)
| Layer | `develop` | `main` (prod) | Status |
|-------|-----------|---------------|--------|
| Backend API | Railway service (TODO) | Railway service ✅ | partial |
| Frontend | Vercel Preview (ADR-001) / Railway today | Railway today → Vercel (ADR-001) | to migrate |
| Database | separate Atlas DB (TODO, D5) | Atlas ✅ | partial |
| Redis/ES | per-env instances (verify) | exists | verify |

## CI/CD inventory (post-fix)
- `ci-frontend.yml` — lint → test → build, path-filtered to `Front-end/web/**`, all branches.
- `ci.yml` — backend jest + coverage floor, path-filtered to `Back-end/server/**`, all branches (incl. `develop`).
- `deploy.yml` — test-gated Railway deploy on push to `main`; needs GH secrets `RAILWAY_TOKEN`, `RAILWAY_BACKEND_SERVICE_NAME`, `RAILWAY_FRONTEND_SERVICE_NAME`.

## Notes
- Health endpoints exist: BE `/health`, FE `/api/health` + `/api/warmup`. Build reproducibility: multi-stage Docker, non-root `nextjs` user, standalone output (good).
