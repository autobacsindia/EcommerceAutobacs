# CLAUDE.md

Autobacs India e-commerce. Monorepo, two apps. Both deploy to Railway via `deploy.yml` on push to `main` (test-gated).

## Layout

- `Front-end/web/` — Next.js 15 (App Router, React 19, TS, Tailwind). See [Front-end/web/CLAUDE.md](Front-end/web/CLAUDE.md).
- `Back-end/server/` — Express + MongoDB (Mongoose) API, ESM. See [Back-end/server/CLAUDE.md](Back-end/server/CLAUDE.md).
- `docs/` — audit reports, ADRs.
- Node `>=20.9.0` both apps.

## API contract

- Backend serves under `/api/v1/*`.
- Frontend proxies `/api/*` → `${NEXT_PUBLIC_API_URL}/api/v1/*` via `next.config.ts` rewrites. Never hardcode backend host in frontend code.

## CI (`.github/workflows/`)

- `ci-frontend.yml` — lint → test → build. Triggers on `Front-end/web/**`.
- `ci.yml` — backend jest + 60% line-coverage floor. Triggers on `Back-end/server/**`.
- `deploy.yml` — Railway deploy on `main`, per-service, gated on that service's tests.

## House rules

- Markdown sprawl: many `*_FIX.md` / `*_SUMMARY.md` files at root and in app dirs are historical notes, not specs. Don't trust them as current; verify against code.
- Secrets never committed. Rotation runbooks in `SECRETS_ROTATION_GUIDE.md`.
- Don't touch `node_modules/` (untracked).
