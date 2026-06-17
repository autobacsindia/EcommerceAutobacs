# Environment Separation & Clean Production Migration

Goal: split **test/dev data** from **real migrated WooCommerce data** into two
isolated environments, wired by env vars per branch. WordPress retires at launch.

## Why
Test users/orders (~20–25 users, some products, some orders injected by mistake)
live in the **same Atlas DB** as the migrated WP data. Git branches separate
**code**, not **data**. Separation requires distinct data stores selected by
`MONGO_URI` / `REDIS_URL` per environment.

Real WP data is tagged: `wpId` on User, Order, Article, Review, Product, Category;
Order also carries `source: woocommerce|web`. Test data has no `wpId` /
`source: web`. We do **not** rely on deleting test rows — we build prod fresh, so
it can never contain test junk.

## Target topology

| | `develop` branch | `main` branch |
|---|---|---|
| Railway service | staging | production |
| Mongo (Atlas) | current (dirty) DB → staging | **new separate cluster** |
| Redis (Railway) | staging instance | prod instance |
| Data | migrated WP + test data | migrated WP only |

Decision taken: **separate Atlas cluster** for prod (hard isolation, own
network/users/backups) — not just a different DB name on the shared cluster.

---

## Phase 1 — Provision prod stores

1. **Atlas**: create a new **cluster** for production (e.g. `autobacs-prod`).
   - New DB user, IP allowlist (Railway egress), separate backup policy.
   - Capture its `MONGO_URI`.
2. **Railway**: add a **production Redis** service → capture `REDIS_URL`.
   - Keep the existing Redis as **staging**.

## Phase 2 — Wire Railway environments

- **Production env** vars: prod `MONGO_URI` + prod `REDIS_URL` (+ all app secrets).
  Deployed from `main`.
- **Staging env** vars: current (dirty) `MONGO_URI` + staging `REDIS_URL`.
  Deployed from `develop`.
- Secrets live in Railway per-environment. Never in the repo. Local `.env` is dev only.
- Sanity-check both: `node scripts/validate-production-env.js`.

## Phase 3 — Build clean prod data

Run from `Back-end/server`, with `.env` (or shell) pointing `MONGO_URI` at the
**prod cluster** and WordPress + Cloudinary creds set. **Triple-check `MONGO_URI`
is prod before each run.** All scripts upsert by unique `wpId` → idempotent.

```bash
cd Back-end/server

# 1. Products + categories (dry run first — review insert/update counts)
node scripts/migrate-from-wordpress.js --dry-run
node scripts/migrate-from-wordpress.js

# 2. Dedup check (should report 0)
node scripts/dedup-wp-products.js
node scripts/dedup-wp-products.js --apply   # only if twins found

# 3. Customers, posts, orders, reviews
node scripts/import-wp-customers.js
node scripts/import-wp-posts.js
node scripts/import-wp-orders.js
node scripts/import-wp-reviews.js

# 4. Article images → Cloudinary
node scripts/rehost-wp-article-images.js

# 5. Parity check vs WooCommerce — counts must match
node scripts/verify-wp-parity.js
```

Prod cluster now holds **only** real WP data. The old dirty DB stays as staging,
test work untouched.

## Phase 4 — Branch workflow

- `develop` = all dev/testing → deploys to **staging** (dirty DB).
- `main` = production → deploys to **prod** cluster.
- Promote via PR `develop → main`. `git diff develop..main` = code delta only;
  data is environment-bound, never travels with the branch.

Deploys use **Railway native GitHub integration** (no `deploy.yml`). Per service:
connect repo, set Branch (`main`→prod services, `develop`→staging services),
Root Directory (`Back-end/server` / `Front-end/web`), Watch Paths, and enable
**Wait for CI** so `ci.yml` / `ci-frontend.yml` gate every deploy. Staging
services point at staging stores so a `develop` push never touches prod.

## Phase 5 — Launch day (WordPress retired)

1. Freeze WooCommerce writes (maintenance / read-only).
2. Final delta run of Phase 3 scripts against prod (catch orders/customers since
   last import — idempotent, safe to repeat).
3. `node scripts/verify-wp-parity.js` → counts match. Resolve any non-zero.
4. Point the domain at the new site.
5. WordPress → offline/read-only. 301 redirects from old permalinks already built
   from `Article.wpUrl` (ADR-005).
6. From here, new site is sole source of truth — no dual-run, no ongoing sync.

## Rollback

- Prod DB issue: prod is a separate cluster, so re-run Phase 3 (idempotent) or
  restore from the prod cluster's own backup. Staging is unaffected.
- Bad deploy: revert `main`, redeploy.

---

# Variable segregation

Three classes: **per-env** (MUST differ prod↔staging), **shared** (same value
both), **migration-only** (needed only where import scripts run).

## Backend — per-environment (MUST differ)

| Var | Prod | Staging | Why separate |
|---|---|---|---|
| `MONGO_URI` | prod cluster | M0 free cluster | the whole point |
| `REDIS_URL` | prod Redis | staging Redis | cache/session isolation |
| `FRONTEND_URL` / `FRONTEND_URLS` | live domain | staging domain | CORS + links |
| `JWT_SECRET` | secret A | secret B | a staging token must not be valid on prod |
| `RESET_TOKEN_SECRET` | secret A | secret B | same reason |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET` | **live** keys | **test** keys (`rzp_test_`) | never charge real cards from staging |
| `RAZORPAY_WEBHOOK_SECRET` | live webhook | test webhook | mode-specific |
| `GOOGLE_CALLBACK_URL` | prod domain | staging domain | OAuth redirect whitelist |
| `GOOGLE_CLIENT_ID` / `_SECRET` | prod OAuth app | staging OAuth app (or shared with both callbacks whitelisted) | redirect safety |
| `ENABLE_EMAIL_NOTIFICATIONS` | `true` | `false` | don't email real customers from staging |
| `ENABLE_SMS_NOTIFICATIONS` | `true` | `false` | don't SMS real customers from staging |
| `SENDGRID_FROM_EMAIL` | live sender | sandbox/unused | reputation + accidental sends |
| `SENTRY_ENVIRONMENT` | `production` | `staging` | clean error triage |
| `CLOUDINARY_*` | prod cloud/folder | **separate cloud or folder** | deterministic public_ids → staging can overwrite prod images |
| `ELASTICSEARCH_NODE` | prod index | staging index | search isolation (if enabled) |

> `NODE_ENV` = `production` on **both** (so staging exercises prod code paths).
> Differentiate behavior via `SENTRY_ENVIRONMENT`, not `NODE_ENV`.

## Backend — shared (same value both)

`JWT_EXPIRE`, `JWT_ADMIN_EXPIRE`, `PORT`, `REGION_ID`, `CACHE_VERSION`,
all business config (`WAREHOUSE_*`, `STOCK_*`, `DELIVERY_*`, `LOW_STOCK_THRESHOLD`,
`ENABLE_SPLIT_SHIPMENTS`), rate-limit maxes, `GOOGLE_MAPS_*` (restrict by
referrer/IP), notification retry tuning. Env-agnostic — keep identical to reduce drift.

## Backend — migration-only (set only where import scripts run)

Needed on **staging** and during the **prod build** (Phase 3). Can be removed from
prod runtime after launch (WP retired):

`WORDPRESS_SITE_URL`, `WORDPRESS_API_KEY`, `WORDPRESS_API_SECRET`,
`WORDPRESS_API_VERSION`, `IMPORT_BATCH_SIZE`, `IMPORT_DELAY_BETWEEN_BATCHES`,
`MONGODB_ATLAS_PUBLIC_API_KEY`, `MONGODB_ATLAS_PRIVATE_API_KEY`,
`MONGODB_ATLAS_PROJECT_ID`, `MONGODB_ATLAS_CLUSTER_NAME`.

## Frontend — per-environment

| Var | Prod | Staging |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | prod backend URL | staging backend URL |
| `NEXT_PUBLIC_POSTHOG_KEY` | prod project (or unset) | staging project / unset | 

> Frontend proxies `/api/*` → `${NEXT_PUBLIC_API_URL}/api/v1/*`. Never hardcode host.

## CI / GitHub Actions secrets

None required for deploy — Railway native integration handles it. `ci.yml` /
`ci-frontend.yml` run on every branch and act as the deploy gate via Railway's
**Wait for CI**. (`deploy.yml` removed.)

---

# Manual checklist (console work — not in repo)

**Atlas**
- [ ] New **dedicated cluster** `autobacs-prod` (own project): DB user, Railway-IP allowlist, backups on.
- [ ] New **M0 free cluster** `autobacs-staging` (separate project) — OR downgrade the current dirty cluster to M0 and treat it as staging.
- [ ] Grab both `MONGO_URI`s.

**Railway**
- [ ] Create staging backend + frontend services (or a staging environment).
- [ ] Add staging Redis service; keep existing Redis as the other env.
- [ ] Set all per-env vars above on prod services and staging services.

**Railway native deploy (per service: prod-be, prod-fe, staging-be, staging-fe)**
- [ ] Connect repo; set Branch (`main`/`develop`), Root Directory, Watch Paths.
- [ ] Enable **Wait for CI**.

**Razorpay / Google / SendGrid / Twilio**
- [ ] Test-mode Razorpay keys + webhook for staging; live for prod.
- [ ] OAuth callback URLs whitelisted for both domains.
- [ ] Staging email/SMS disabled (`ENABLE_*_NOTIFICATIONS=false`).

**Then run Phase 3** against the prod cluster → `verify-wp-parity.js`.

**Code changes already done in repo:** removed `deploy.yml` (deploys now via
Railway native + Wait-for-CI) and added this runbook.
...