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

## Environments (dev vs prod)

Two tiers. **Dev** = local files (`Back-end/server/.env`, `Front-end/web/.env.local`), loaded by `npm run dev`, pointing ONLY at dev-only backing services. **Prod** = Railway dashboard (backend) + Vercel dashboard (frontend). The committed `.env.example` files are the contract. Full dev↔prod variable matrix, footguns (`MONGODB_URI`≠`MONGO_URI`; cross-app `JWT_SECRET`), and setup checklist: **[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)**.

## Migration status (WooCommerce → this stack)

The live site `autobacsindia.com` is still **WooCommerce/WordPress**. This repo is the replacement, in development. Keep WooCommerce live until cutover; don't break it.

- **Now (dev):** backend + frontend both on Railway (`*.railway.app`).
- **Target:** backend on Railway → `api.autobacsindia.com`; frontend on **Vercel** → `autobacsindia.com`. Redis/Elasticsearch/Cloudinary/Postmark stay (domain-independent).
- **The move is env-only** — code is env-driven, no host edits needed. Key vars: frontend `NEXT_PUBLIC_API_URL` (→ `https://api.autobacsindia.com`), `NEXT_PUBLIC_APP_URL` (→ `https://autobacsindia.com`), `BACKEND_API_URL` (suggestions route, needs `/api/v1`); backend `FRONTEND_URL`/`FRONTEND_URLS` (CORS), `GOOGLE_CALLBACK_URL`, `NODE_ENV=production`.
- **Also at cutover:** split Redis into `REDIS_URL` (cache/sessions) + `QUEUE_REDIS_URL` (BullMQ/rate-limit); `COOKIE_DOMAIN`/`COOKIE_SAMESITE` matter once api/apex are separate subdomains. External dashboards: Cloudflare DNS (apex→Vercel, `api`→Railway, low TTL for rollback), Google OAuth redirect URI, Razorpay webhook, Postmark sender domain.
- **Gotcha:** legacy `autobacsindia.com/wp-content/**` images (`next.config.ts` allowlist) die when the apex leaves WordPress — migrate to Cloudinary first. Flush Redis `route:*`/`public:*` after cutover.
- **Full step-by-step:** [docs/RUNBOOK-cdn-redis-vercel.md](docs/RUNBOOK-cdn-redis-vercel.md).

## SEO (config-driven — follow this for every new page/feature)

SEO is centralized, not hand-rolled per page. Adding a new entity or page means
wiring it into this system — never write ad-hoc `generateMetadata`.

Precedence everywhere: **admin override → computed default (from the entity/page) → site default**. All output goes to `<head>` + JSON-LD, never visible page clutter. A new entity is SEO-complete the moment it's saved (defaults derive from its normal fields — name/title + shortDescription/excerpt). The admin override is optional polish.

Shared primitives:
- Backend: embed `seo` from `Back-end/server/models/shared/seoSchema.js`; normalize writes with `utils/seo.js` `normalizeSeo()`. Ensure the entity's public GET returns `seo`.
- Frontend: render with `Front-end/web/src/lib/seo.ts` `resolveSeo()`. Admin editing uses `components/admin/SeoPanel.tsx` (hydrate from `entity.seo`, send `seo` in the payload).

**New entity-backed page** (like product/blog/category/brand): add `seo` subdoc to the model → normalize in its create/update controller → drop `<SeoPanel>` into its admin editor → `resolveSeo` in the page's `generateMetadata` → add it to `sitemap.ts` (and a backend `/sitemap` data endpoint) honoring `noindex`.

**New static / entity-less page** (like careers/contact): add the route to `Back-end/server/config/staticPages.js` → manage via the `PageSeo` collection + `/admin/seo` screen → render with `Front-end/web/src/lib/pageSeo.ts` `buildPageMetadata(path, fallback)` (a server component exports it directly; a client page gets a sibling `layout.tsx` that does). Add the route to `sitemap.ts` static list.

Rules: `noindex` (SeoPanel/PageSeo) drops a page from both `<head>` robots and `sitemap.xml`. Private routes go in `robots.ts` disallow + never in the sitemap. Tags are a search/data signal, not UI clutter; `focusKeyword` is an internal note only (never rendered, ignored by Google). Flush Redis `route:*`/`public:*` after bulk SEO/data changes.

## CI (`.github/workflows/`)

- `ci-frontend.yml` — lint → test → build. Triggers on `Front-end/web/**`.
- `ci.yml` — backend jest + 60% line-coverage floor. Triggers on `Back-end/server/**`.
- `deploy.yml` — Railway deploy on `main`, per-service, gated on that service's tests.

## House rules

- Markdown sprawl: many `*_FIX.md` / `*_SUMMARY.md` files at root and in app dirs are historical notes, not specs. Don't trust them as current; verify against code.
- Secrets never committed. Rotation runbooks in `SECRETS_ROTATION_GUIDE.md`.
- Don't touch `node_modules/` (untracked).
