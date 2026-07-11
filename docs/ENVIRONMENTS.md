# Environments — Dev vs Prod separation

How configuration is split across three tiers: **dev** (local, `npm run dev`), **test/staging**
(the `develop` branch, deployed), and **prod** (the `main` branch, deployed). Backend runs on
Railway, frontend on Vercel.

> The live customer site is still WooCommerce/WordPress. The "prod" tier here is the
> replacement stack; it becomes customer-facing at cutover. See root
> [CLAUDE.md](../CLAUDE.md) "Migration status" and
> [RUNBOOK-cdn-redis-vercel.md](RUNBOOK-cdn-redis-vercel.md).

## Deploy tiers & branch → environment

Two long-lived branches, **no feature branches**: commit to `develop`, verify on the test tier,
then merge `develop` → `main` to release. Both apps auto-deploy on push.

| Branch | Backend (Railway env) | Frontend (Vercel) | Data |
|---|---|---|---|
| `develop` | project `bountiful-surprise`, env **test** | **Preview** deployment (per-branch alias) | `autobacstest` cluster, test Redis, ES off |
| `main` | project `bountiful-surprise`, env **production** | **Production** deployment | prod `cluster0`, Upstash cache + prod Redis queue, ES on |

Verified isolation (as of 2026-07): test and prod use **separate Atlas clusters**, **separate Redis**
(prod cache = Upstash, all others = per-env Railway Redis — private domains are environment-scoped),
and email in test is caught by `EMAIL_REDIRECT_TO`. Elasticsearch is the one **shared** deployment;
it's safe only because test has `ELASTICSEARCH_ENABLED=false`. **If you enable ES in test, you MUST set
`ELASTICSEARCH_INDEX` (e.g. `products_staging`)** or a test reindex will clobber the prod `products` index.

Gotchas specific to the test tier:
- `NEXT_PUBLIC_API_URL` is **build-time baked** — the Vercel **Preview** scope must set it to the test
  backend, or previews silently call prod.
- The test backend's `FRONTEND_URL` / `FRONTEND_URLS` must list the develop preview URL (for CORS/redirects).
- Railway's git source for the **test** env must be the `develop` branch (not `main`).

## The rule

| Tier | Backend config lives in | Frontend config lives in |
|---|---|---|
| **dev** | `Back-end/server/.env` (local, gitignored) | `Front-end/web/.env.local` (local, gitignored) |
| **prod** | **Railway dashboard** env vars | **Vercel dashboard** env vars (Production scope) |

`npm run dev` (backend: nodemon + dotenv; frontend: next dev) loads the local files. Those files
must point at **dev-only** backing services so local development can never touch production data.
The committed `.env.example` files are the contract — they document every variable but hold no secrets.

> **Why this matters:** before this split there was one environment — the local backend `.env` held
> the prod DB/Redis/Cloudinary, so `npm run dev` read and wrote production. The worst case is a local
> BullMQ worker pulling and processing **real prod jobs** off shared queue Redis.

## Backing services — provision a separate DEV instance for each

| Service | Dev instance | Prod instance |
|---|---|---|
| MongoDB (Atlas) | separate DB, e.g. `autobacs_dev` (same cluster is fine) | prod DB |
| Redis cache/sessions (Upstash) | separate Upstash DB (`rediss://`) | prod Upstash |
| Redis queue/rate-limit (Upstash) | separate Upstash DB (`rediss://`) | prod Upstash |
| Elasticsearch | dev index/deployment, or `ELASTICSEARCH_ENABLED=false` locally | prod ES |
| Cloudinary | dedicated `dev/` folder/upload preset (or a dev cloud) | prod cloud |
| Postmark | sandbox token or separate stream, or `ENABLE_EMAIL_NOTIFICATIONS=false` | prod token/stream |
| Razorpay | `rzp_test_*` + a test-mode webhook | `rzp_test_*` until cutover → `rzp_live_*` + live webhook |
| Google/Facebook OAuth | add `http://localhost:8080/...` redirect URIs to the app | prod redirect URIs |

> Upstash gotcha: `server.js` runs a hard Redis preflight and **exits** on a bad scheme — Upstash
> needs `rediss://`. After prod data/SEO migrations, flush Redis `route:*` / `public:*`.

## Variable matrix

Three buckets: **A = must differ** dev vs prod (isolation/safety critical), **B = safe to share**
(same value both tiers), **C = host-managed** (never set by hand).

### Bucket A — MUST differ dev vs prod

**Backend** (`.env` locally → Railway in prod):

| Var | Dev | Prod | Why |
|---|---|---|---|
| `MONGO_URI` | dev Atlas DB (`autobacs_dev`) | prod Atlas DB | **#1 risk** — never let dev write prod data |
| `MONGODB_URI` | = dev `MONGO_URI` (footgun, see below) | unset unless a prod script needs it | scripts/tests read this name |
| `REDIS_URL` | dev Upstash | prod Upstash | dev must not poison prod cache |
| `QUEUE_REDIS_URL` | dev Upstash | prod Upstash | **dev worker must not consume prod jobs** |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | `rzp_test_*` | `rzp_test_*` → `rzp_live_*` at cutover | test vs live mode |
| `RAZORPAY_WEBHOOK_SECRET` | test-mode webhook secret | live-mode webhook secret at cutover | separate webhook endpoints |
| `JWT_SECRET` | dev secret (≥64 chars) | prod secret (≥64 chars) | leaked dev token must not forge prod sessions; **must match frontend in same tier** |
| `FRONTEND_URL` | `http://localhost:3000` | `https://autobacsindia.com` | CORS/redirects; prod must be HTTPS (validateEnv enforces) |
| `FRONTEND_URLS` | `http://localhost:3000` | apex + www (+ Railway URL pre-cutover) | CORS allowlist |
| `GOOGLE_CALLBACK_URL` | `http://localhost:8080/api/v1/auth/google/callback` | prod callback | OAuth redirect per host |
| `FACEBOOK_REDIRECT_URI` | localhost | prod | same |
| `NODE_ENV` | `development` | `production` | gates validateEnv, cookie flags, logging |
| `ELASTICSEARCH_NODE` / `_USERNAME` / `_PASSWORD` | dev index (or disabled) | prod ES | dev reindex must not touch prod index |
| `CLOUDINARY_*` | dev cloud / `dev/` folder | prod | don't pollute prod media |
| `POSTMARK_SERVER_TOKEN` / `POSTMARK_FROM_EMAIL` / `POSTMARK_MESSAGE_STREAM` | token + `noreply@autobacsindia.com` (or disabled) | prod token/sender | dev sends must not hit sender reputation |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | unset / `development` | prod DSN / `production` | keep dev noise out of prod |
| `SLACK_WEBHOOK_URL` | **unset locally** | prod webhook | dev 5xx must not page the team |
| `COOKIE_DOMAIN` / `COOKIE_SAMESITE` | unset / `lax` | `.autobacsindia.com` / set at cutover | cross-subdomain cookies only in prod |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | dev seed creds | prod seed creds (set, run `seed:admin`, remove) | separate admin per DB |
| `COMPANY_*` (`NAME`/`GSTIN`/`ADDRESS`/`CITY`/`STATE`/`PINCODE`/`PHONE`/`EMAIL`/`LOGO_URL`) | dev placeholders | real legal entity details | printed on the invoice PDF (see `config/company.js`) |
| `INVOICE_STORE_CLOUDINARY` | `false` | `false`/`true` | optional: archive invoice PDFs to Cloudinary (email always attaches regardless) |

**Frontend** (`.env.local` locally → Vercel in prod):

| Var | Dev | Prod | Why |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | `https://api.autobacsindia.com` | `/api/*` rewrite target |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://autobacsindia.com` | build-time baked site URL |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_test_*` | matches backend tier | must match backend key |
| `JWT_SECRET` (server-side, NOT public) | = backend dev `JWT_SECRET` | = backend prod `JWT_SECRET` | edge middleware verifies backend JWTs |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_LOGROCKET_APP_ID` | dev project or unset | prod project | keep dev events out of prod analytics |
| `NEXT_PUBLIC_ALLOW_WP_IMAGES` | `true` | `true` pre-cutover → `false` after Cloudinary migration | env-gates legacy `autobacsindia.com/wp-content` image allowlist in `next.config.ts` |

### Bucket B — safe to SHARE (same value both tiers)

Tuning/config with no data or identity coupling: `JWT_EXPIRE`, `JWT_ADMIN_EXPIRE`,
rate-limit maxes (`REGISTER_/LOGIN_/FAILED_LOGIN_RATE_LIMIT_MAX`), `GOOGLE_MAPS_REGION`,
`GOOGLE_MAPS_LANGUAGE`, delivery settings (`WAREHOUSE_PROCESSING_DAYS`, `EXCLUDE_SUNDAYS`,
`DELIVERY_ESTIMATE_BUFFER`), inventory settings (`STOCK_RESERVATION_TIMEOUT`, `LOW_STOCK_THRESHOLD`,
`ENABLE_SPLIT_SHIPMENTS`, `STOCK_SYNC_FREQUENCY`), notification retry, `CACHE_VERSION`,
location params. `GOOGLE_CLIENT_ID/SECRET` and `FACEBOOK_CLIENT_ID/SECRET` can be shared (one app,
multiple redirect URIs) — only the `*_CALLBACK_URL` / `*_REDIRECT_URI` differ. `GOOGLE_MAPS_*_KEY`
and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` can be shared (restrict per env).
`NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` is prod-only meaningful.

### Bucket C — HOST-managed, NEVER set manually

Auto-injected by the platform; setting them by hand breaks detection:
`RAILWAY_*` (`RAILWAY_PUBLIC_URL`, `RAILWAY_DEPLOYMENT_ID`, `RAILWAY_ENVIRONMENT`), `DYNO`,
`CONTAINER`, `AWS_EXECUTION_ENV`, `CI`, `VERCEL`, `VERCEL_ENV`, `VERCEL_OIDC_TOKEN`.
`PORT` is host-assigned in prod — set it locally only.

### Legacy — keep OUT of runtime/prod

`WORDPRESS_*` / `WOOCOMMERCE_*` are migration-script-only, not server runtime. Don't put them in the
prod dashboards. For a one-off import, keep them in a local `.env.migration` you source manually.

## Two footguns in the code

1. **`MONGODB_URI` ≠ `MONGO_URI`.** The server runtime reads `MONGO_URI`, but the one-off scripts in
   `Back-end/server/scripts/` and the test setup (`tests/setupEnv.js`) read **`MONGODB_URI`**. If
   `MONGODB_URI` ever points at prod, running any script silently hits prod. **Mirror it to the dev DB
   locally**, and don't set it in the Railway prod dashboard unless a specific prod script needs it.
2. **Cross-app `JWT_SECRET` coupling.** The frontend edge middleware
   ([Front-end/web/src/middleware.ts](../Front-end/web/src/middleware.ts)) verifies backend-signed JWTs
   using its own `JWT_SECRET`. Backend and frontend `JWT_SECRET` must be **identical within a tier** and
   **different across tiers**. A rotation must update BOTH apps in that tier.

## Where the code reads this (no code changes needed — fully env-driven)

- Backend validation/boot: [config/validateEnv.js](../Back-end/server/config/validateEnv.js) (fails fast
  in prod if `FRONTEND_URL`/`RAZORPAY_WEBHOOK_SECRET` missing or `FRONTEND_URL` not HTTPS; enforces
  `JWT_SECRET` ≥ 64 chars), DB connect: `config/db.js`.
- Frontend proxy: `Front-end/web/next.config.ts` rewrites `/api/*` → `${NEXT_PUBLIC_API_URL}/api/v1/*`.

## Setup checklist

1. Provision the dev instances in the table above (Atlas DB, 2× Upstash, ES, Cloudinary, Postmark,
   Razorpay test webhook, OAuth localhost redirect URIs).
2. Backend dev: copy `Back-end/server/.env.example` → `.env`; fill Bucket A dev + Bucket B; generate a
   fresh dev `JWT_SECRET`; set `MONGODB_URI` = dev `MONGO_URI`; leave `SLACK_WEBHOOK_URL` / prod
   `SENTRY_DSN` unset.
3. Backend prod: set Bucket A prod + Bucket B in the Railway dashboard; `NODE_ENV=production`.
4. Frontend dev: copy `Front-end/web/.env.example` → `.env.local`; point at the local backend; set
   server-side `JWT_SECRET` = backend dev secret.
5. Frontend prod: set the same vars in the Vercel dashboard (Production scope); `JWT_SECRET` = backend
   prod secret.

## Rotating a secret

- `JWT_SECRET`: update **both** the backend and frontend of that tier together (else edge auth breaks).
- Service credentials (Razorpay/Cloudinary/Postmark/Redis/Mongo): rotate the dev and prod instances
  independently. General rotation runbooks: `SECRETS_ROTATION_GUIDE.md`.
