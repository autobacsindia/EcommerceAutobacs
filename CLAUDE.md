# CLAUDE.md

Autobacs India e-commerce. Monorepo, two apps. Both deploy on push to `main` via **platform auto-deploy** (Railway backend, Vercel frontend). There is **no `deploy.yml`** — the deploy gate is GitHub **branch protection** requiring the CI checks below, so unvetted commits can't reach `main` and therefore can't deploy. (Gating only holds if branch protection is actually enforced.)

This is a **transactional commerce product**: catalog, search, cart, checkout, payments, orders, fulfilment. That shape dictates the standards below. The governing instinct is the **inverse of a social app** — money, stock, and order state are never optimistic; they are server-authoritative, idempotent, and confirmed before the UI commits to them.

## Layout

- `Front-end/web/` — Next.js 15 (App Router, React 19, TS, Tailwind). See [Front-end/web/CLAUDE.md](Front-end/web/CLAUDE.md).
- `Back-end/server/` — Express + MongoDB (Mongoose) API, ESM. See [Back-end/server/CLAUDE.md](Back-end/server/CLAUDE.md).
- `docs/` — audit reports, ADRs.
- Node `>=20.9.0` both apps.

App-specific detail lives in the two sub-`CLAUDE.md` files; this root doc owns the **cross-cutting** contract, decisions, and standards. When a rule below and a sub-doc disagree, the sub-doc wins for that app — surface the conflict.

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

---

## Architecture decisions to honor (correctness, scale & UX)

These are the standing calls for the platform. They exist so new code is consistent and doesn't regress the product into wrong charges, oversells, stale prices, or a search index that lies. Each is detailed in **[Production standards](#production-standards-for-an-e-commerce-platform)**; this table is the index. If a task seems to require diverging from one, **stop and ask** (working agreement rule #7).

| Decision | The rule | Why |
|----------|----------|-----|
| **Payment truth = the verified webhook** | An order is fulfilled only on a signature-verified Razorpay webhook, **never** on the client redirect/callback. Both the callback and the webhook converge on **one idempotent fulfilment routine** keyed by order/payment id. | The client redirect can be dropped (closed tab, dead network) or spoofed. The webhook is the authoritative server-to-server signal. This is the webhook-vs-callback race — design for it, don't get surprised by it. |
| **Money is never optimistic** | Cart-add and wishlist may update the UI instantly. Price, totals, tax, shipping, discounts, stock commitment, and payment status are **server-computed and shown only after the server confirms**. | Optimistic money means wrong charges and oversells. This is the one place the social-app instinct is inverted. |
| **Server is the pricing authority** | Never trust client-sent prices, totals, or discounts. **Recompute the cart server-side at checkout** from current catalog prices + server-validated coupons. | Client price fields are display only; anything else is a tampering vector. |
| **Every product write syncs Elasticsearch** | Any path that mutates a product — create, update, **`updateMany`, `bulkWrite`** — must enqueue the ES sync. Mongoose middleware does **not** fire on `updateMany`/`bulkWrite`. | Silent index drift makes search show wrong price/availability. This exact bug bit `brands.js`/`vehicles.js`. |
| **Cursor pagination on every list** | Catalog, search results, orders, admin tables — keyset cursors, bounded page size. No `skip`/`offset` on large or growing collections. | Offset degrades linearly and skips/duplicates under concurrent writes; catalog and orders only grow. |
| **Cache is invalidated on write** | Purge Redis `route:*`/`public:*` and the matching Cloudflare edge entries when the underlying catalog/price/SEO changes — don't wait for TTL. | Stale price or availability at the edge is a trust and consumer-law problem, not a cosmetic one. |
| **Idempotent side effects** | Webhooks, order creation, payment capture, and transactional emails are idempotent — a retry or double-submit yields **one** order, **one** charge, **one** email. | Razorpay retries webhooks; users double-click "Pay"; networks replay. |
| **Rate-limit by real client IP** | Behind Cloudflare, key limiters on **`cf-connecting-ip`**, never `req.ip` (Cloudflare's edge). Strict limits on auth, checkout, coupon-apply, and search. | `req.ip` collapses every user into one bucket — the limiter silently does nothing. |
| **Stock is a coarse manual enum** | Availability is `in / low / out`, admin-set. Do **not** build quantity-decrement, reservations, or the dead `WarehouseInventory` into checkout. True quantity tracking is a deliberate schema decision, never an inline addition. | The model doesn't hold quantity; phantom reservation logic would lie. Prefer the simple established model. |
| **SEO is config-driven** | New pages/entities wire into the centralized SEO system (**admin override → computed default → site default**); never hand-roll `generateMetadata`. | Already the house standard — see the [SEO section](#seo-config-driven--follow-this-for-every-new-pagefeature). Consistency + full JSON-LD coverage. |
| **Orders are immutable financial records** | Snapshot price, product title, tax, and address **onto the order** at creation. Never render a historical order from live product/price documents. | A price or title edit must not silently rewrite what a customer was charged last month. |

---

## How to make changes here (working agreement)

The failure mode this repo optimizes against: a change that **runs on the happy path but leaves money, inventory, or search-index edge cases for the human to find by hand** — a payment that double-fulfils on webhook retry, a bulk product update that skips the ES sync, a total the client could tamper with, a catalog page that serves a stale price from cache. Those are exactly what a quick manual smoke test misses. Close them yourself before handing work back.

1. **Plan before non-trivial code.** For anything beyond a one-liner, first enumerate: the files you'll touch, every input / boundary / state the change must handle (**including empty, error, and retry cases**), and the **invariants** that must hold afterward. For this platform the recurring invariants are: *an order is fulfilled only after a verified payment*; *the server recomputes every total*; *every product write syncs ES*; *payment/order handling is idempotent under retries*; *auth failure never returns 200*; *cache is purged on any catalog/price change*. Surface the list and wait for confirmation **before** writing code. Most leftover bugs are cases that were never named.

2. **Tests are the contract, and you run them.** Write or extend tests (jest) covering the cases and invariants from step 1 — not just the happy path. For commerce that specifically means: **webhook idempotency (same event twice → one fulfilment), callback-vs-webhook race, server-side price/coupon recomputation rejecting tampered input, ES-sync enqueued on `updateMany`/`bulkWrite`, cursor pagination boundaries, and cache purged on write.** Run them and iterate until green **before reporting back**. **Run the full local suite, not just CI's curated subset** — CI runs a subset (see [CI](#ci-githubworkflows)), so green CI is not proof the whole suite passes.

3. **Feature and optimization are two separate passes — never the same diff.** Get the change correct and tested first, commit that. *Then* optimize as a distinct change with the tests standing guard: green means behavior was preserved; red means the optimization broke something and you know instantly. (Adding a cache layer, swapping a Mongo regex search to ES, or introducing an index is an *optimization pass*.)

4. **Measure before optimizing.** No speculative caching or query-rewriting. Find the real bottleneck with timing or query data first — the usual suspects here are N+1 Mongoose `populate`, a missing index, an unpaginated catalog/order query, a Mongo regex search that belongs in Elasticsearch, or an un-purged cache serving stale data. Fix that one thing, then re-measure. Caching and fan-out are **earned by a measurement**, never assumed.

5. **Fixing a bug → add a regression test** that fails before your fix and passes after. Then check whether the *same class* of bug exists in the files you touched — a missing ES-sync on one bulk-write path is usually missing on its siblings; an un-purged cache key on one controller is usually un-purged on the next.

6. **Keep diffs small.** One feature = one change. Decompose (endpoint + tests → wire the client → edge/error/retry cases) so each piece reaches "done" before the next stacks on top. Large diffs are where regressions hide.

7. **When unsure, stop and ask** rather than guessing — especially on anything touching **payments, order state, money math, or the ES sync**, and any divergence from an [architecture decision above](#architecture-decisions-to-honor-correctness-scale--ux).

### Definition of done

A change is not done until, as applicable:

- [ ] Plan was confirmed (for non-trivial work).
- [ ] Backend jest passes locally — **full suite, including new tests for this change** — and clears the **60% line-coverage floor**.
- [ ] Frontend `lint → test → build` passes.
- [ ] Edge, error, and **retry** cases from the plan are handled **and tested**, not just the happy path.
- [ ] **Payment/order side effects are idempotent** and driven by the **verified webhook**, with a tested "same event twice → one fulfilment" case.
- [ ] **All money is server-computed**; no client-sent price/total/discount is trusted; coupon validation is server-side.
- [ ] **Every product-mutating path enqueues the ES sync** (including `updateMany`/`bulkWrite`).
- [ ] **List reads are cursor-paginated and bounded**; no `skip`/`offset` on growing collections.
- [ ] **Cache/CDN is purged** for any catalog/price/SEO change the write affects.
- [ ] Multi-document writes (order + payment record + stock/enum + email trigger) are consistent (a transaction/session or a compensating path).
- [ ] New pages/entities are **wired into the SEO system**, not hand-rolled.
- [ ] No optimization was smuggled into a feature diff.
- [ ] You've stated **which cases you tested and what you did *not* cover**, so the human knows where to look.

---

## Production standards for an e-commerce platform

The detail behind the [decisions table](#architecture-decisions-to-honor-correctness-scale--ux). These are how the platform stays correct, fast, and scalable. New code follows them; existing code is migrated in dedicated optimization passes, not smuggled into feature diffs.

> **Prefer what already exists.** The backing infrastructure is chosen and in place — **Razorpay** (payments), **MongoDB/Mongoose** (data), **Elasticsearch** (catalog search), **Redis** (cache/sessions) + **BullMQ** (jobs/queues), **Cloudinary** (media), **Postmark** (email), **Twilio** (SMS), **Cloudflare** (CDN), and the **config-driven SEO system**. Where one of these covers the job, **use it** — do not stand up a second, parallel way of doing the same thing (a rival cache, a hand-rolled search over Mongo regex, a bespoke queue). Named patterns below describe the *target*; if the repo already satisfies one with an equivalent choice, keep it. Replace an established primitive only as a deliberate, **measured** upgrade with a clear win.

### 1. Payments & orders (Razorpay)

- **The webhook is the source of truth.** Fulfil (mark paid, flip stock, send confirmation) only on a **signature-verified** webhook. The client callback after checkout may *optimistically show* "processing," but it never fulfils.
- **Design for the callback-vs-webhook race explicitly.** Both entry points call one **idempotent fulfilment function** keyed by `razorpay_order_id` / `payment_id`. Whichever arrives first fulfils; the second is a no-op. Never write two code paths that can both fulfil.
- **Idempotency everywhere on the money path.** A replayed webhook, a double-clicked "Pay," or a retried capture must produce exactly one order and one charge. Persist processed event ids; upsert orders on a unique payment key.
- **Verify signatures** on every webhook and every payment-verify call — reject unsigned/mismatched with a 4xx, and never trust amounts from the client.
- **Order state machine.** `created → payment_pending → paid → fulfilled → shipped → delivered` (+ `failed`, `refunded`, `cancelled`). Transitions are explicit and logged; illegal transitions are rejected.
- **Snapshot at order time.** Copy price, title, tax, discount, and shipping address onto the order. Historical orders never dereference live product/price docs.
- **Reconciliation.** A scheduled job cross-checks Razorpay status against local orders to catch any fulfilment the webhook missed. Money discrepancies alert.
- **Refunds** go through Razorpay's API and move the order state; never just flip a flag.

### 2. Cart, pricing & checkout

- **Server-authoritative pricing.** The cart the client holds is a *draft of intent*. At checkout the server recomputes line prices, quantities, tax, shipping, and discounts from the current catalog — the client's numbers are ignored.
- **Coupons/promos validated server-side** (existence, eligibility, min-cart, expiry, per-user limits) at apply *and again* at checkout. The "Apply" button reflects the server's answer; it never computes the discount itself.
- **Price/stock re-check at checkout.** Between add-to-cart and pay, price or availability may change — revalidate and surface changes before capturing payment.
- **Cart-add and wishlist may be optimistic** (they're cheap and reversible); the badge/count updates instantly and reconciles on the server response.

### 3. Inventory / availability

- **Availability is a coarse manual enum** (`in / low / out`), admin-set. Checkout reads it; it does **not** decrement a quantity, because no quantity is tracked. Don't build reservation/decrement logic or revive the dead `WarehouseInventory` — that's a schema decision to make deliberately, not an inline addition.
- **Out-of-stock UX:** an `out` item can't be added or checked out; surface it clearly. If real quantity tracking is ever needed, it's an ADR + migration, not a patch.

### 4. Catalog & search (Elasticsearch)

- **The sync invariant:** every product write keeps ES in sync. Mongoose hooks cover `save`/`findOneAndUpdate`, but **`updateMany` and `bulkWrite` bypass them** — those paths must **enqueue the ES sync explicitly** (via BullMQ), or the index silently drifts.
- **Search goes through Elasticsearch, not Mongo regex** — relevance, fuzziness, and facets belong in ES; Mongo `$regex` scans don't scale and can't rank.
- **Reindex is a known, jobbed operation** (BullMQ), not an ad-hoc script against prod. Keep a documented reindex path; treat a manual reindex as a deliberate convention where a write path legitimately can't hook (e.g. the WordPress cleanup bulk-writes).
- **Guard the feature flag:** if search is enabled, its dependencies (Redis for the queue) must be present — validate at boot rather than failing at first query.

### 5. Caching & CDN (Redis + Cloudflare)

- **Cache-aside** for read-heavy, slow-changing data: catalog pages, product detail, category/brand listings, public config. Keys under the `route:*` / `public:*` conventions.
- **Purge on write.** The controller that changes a product/price/SEO field purges the matching Redis keys **and** the Cloudflare edge entries in the same operation — TTL alone is not acceptable for price/availability. The purge service is wired into admin controllers; keep new write paths wired too.
- **Flush `route:*`/`public:*` after bulk data or SEO changes** and after cutover.
- **`Cache-Control` middleware** sets edge cacheability per route; never edge-cache authenticated or per-user responses under a shared key.
- **Consolidate Redis clients** — one cache/session client, one queue client (`REDIS_URL` vs `QUEUE_REDIS_URL` at cutover). Don't spawn a third.

### 6. Data access (Mongoose)

- **Lean + projected reads.** `.lean()` for read-only paths; project only the fields the view needs. Never return whole documents to a list.
- **Kill N+1.** Batch related lookups; use `populate` deliberately (with field selection) or denormalize hot fields. Don't loop a query per catalog item.
- **Index every filtered/sorted field** (search facets, `createdAt` for cursor pagination, order lookups, coupon codes). An unindexed `WHERE`/`sort` on a growing collection is a latent outage.
- **Bounded queries always** — every list has a limit and a cursor.
- **Multi-document writes use a session/transaction** (order + payment record + stock flip + email enqueue) or an explicit compensating path, so a mid-write failure doesn't leave an orphaned order or a charge with no order.

### 7. Frontend performance & UX (Next.js 15, App Router)

- **Server Components by default;** push client components to the leaves (interactivity only). Keep data-fetching on the server.
- **Explicit caching (Next 15 caches nothing by default).** Opt into caching deliberately with `revalidate` / `fetch` cache options and **cache tags**; invalidate with `revalidateTag` when catalog/price/SEO changes — pair it with the Redis/Cloudflare purge so all three layers agree.
- **Stream with Suspense;** show skeletons, not blank screens, for catalog/PDP loads.
- **Images via Cloudinary + `next/image`** with correct `sizes`; never ship the original. (Legacy `wp-content` images are temporary — see Migration.)
- **Core Web Vitals are conversion metrics here.** Protect LCP (hero/PDP image) and CLS (reserve space for images, price, badges). Measure before shipping list/PDP changes.
- **Optimistic UI only where safe:** cart badge, wishlist, filter toggles. Never optimistic on price, totals, stock commitment, or payment state.

### 8. Security & abuse

- **Rate-limit by `cf-connecting-ip`** (not `req.ip`) behind Cloudflare; strictest on auth, checkout, coupon-apply, and search.
- **Auth carries `sessionVersion`;** every authenticated path (including `optionalAuth`) checks it so a bumped version invalidates stale tokens. Auth failure never returns 200.
- **CORS from `FRONTEND_URL`/`FRONTEND_URLS`** only; **cookies** get `COOKIE_DOMAIN`/`COOKIE_SAMESITE` once api/apex are separate subdomains.
- **Verify every webhook signature** (Razorpay); no unauthenticated mutation endpoints.
- **No secrets in the frontend.** Anything in `NEXT_PUBLIC_*` is public. Backend secrets live in Railway; never committed (see [`SECRETS_ROTATION_GUIDE.md`](SECRETS_ROTATION_GUIDE.md)).
- **No debug/exposed internal routes in prod.**

### 9. Observability & analytics

- **Sentry on both apps;** structured logs with a request id and (where present) user/order id.
- **Conversion tracking fires on verified order success** — the `gtag` conversion event lives on the order-success path, keyed off real fulfilment, not the pre-payment redirect. Don't double-fire on webhook retry.
- **Funnel analytics** for the commerce loop: view → add-to-cart → checkout → paid. Watch drop-off.
- **Alert on the money path:** payment failures, webhook processing errors, reconciliation discrepancies, and order-state anomalies page someone.

### 10. Transactional messaging (Postmark / Twilio)

- **Idempotent sends.** Order-confirmation and shipping emails/SMS fire once per state transition, keyed so a webhook retry doesn't re-send.
- **Transactional stream only** (Postmark) for order lifecycle; marketing/opt-in mail is a separate concern and system.
- **Failures are logged and retryable** (via the queue), never silently swallowed.

---

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
- Deploy: **platform auto-deploy** on `main` push (Railway + Vercel git integrations). No GitHub Actions deploy workflow. Gating = branch protection requiring the two CI checks above. Note: both CI jobs currently run a **curated test subset**, not the full suites — so **run the full suite locally** before declaring anything done; green CI is not proof the whole suite passes.

### Merging to `main` (⚠️ this IS the production deploy)

There is no separate "deploy" step. **A push to `main` deploys to the live store within minutes** — real customers, real Razorpay. Treat the merge itself as the deploy.

- **Always go through a pull request.** Branch protection requires it (`Changes must be made through a pull request`) — but **repo admins can bypass it, and a plain `git push origin main` from an admin account silently succeeds**, printing only `remote: Bypassed rule violations for refs/heads/main`. That push skips the PR review *and* both CI checks. The gate is not a technical guarantee for admins; it is a convention you have to keep. Use `gh pr create` + merge, not a direct push.
- **Order of operations when a change needs a data migration:** deploy the code first, confirm the new behaviour is live in prod, *then* run the migration. Running it first just lets the old code undo it.
- **Prefer a rename-swap over a bulk delete** on any large collection. `deleteMany` over millions of docs costs one oplog entry plus every index update per document; `renameCollection`/`drop` are O(1) metadata. Keep the old collection until you have verified, then drop it.
- **Migration scripts:** dry-run by default, `--apply` to execute, and always print a rollback path. Follow `scripts/purge-test-account-data.js` / `scripts/compact-rate-limit-events.js`.
- **Any script that imports models and then calls `mongoose.connect()` MUST pass `{ autoIndex: false }`.** It defaults to `true`, so merely connecting builds every declared index against whatever cluster the script points at — which in this repo is production, because the local `.env` points at prod Mongo.
- **Check index drift after schema changes:** `npm run audit-index-drift` (in `Back-end/server`). `autoIndex` is off in prod by design, so schema index changes are **never** applied by a deploy — they need a migration. See the [index drift](#index-drift-schemas-vs-the-live-cluster) note below.

### Index drift (schemas vs. the live cluster)

Because prod runs with `autoIndex: false`, the live index set can silently diverge from the schemas — and it did, for months, which cost real data. Two rules:

- **A declared index is not a built index.** MongoDB rejects some specs outright, and Mongoose reports nothing. Notably **`$ne` is not supported inside a `partialFilterExpression`** — use `$type`. Also, declaring the same index name twice with different options (a field-level `index: true`/`unique: true` plus a `schema.index()` call) makes creation fail; that is how `AuditLog`'s 90-day TTL never got created.
- **A TTL index over a subdocument array deletes the parent document**, expiring on the *minimum* date in the array. Production carried two such indexes on `carts.recentChanges` (300s) that erased shoppers' carts five minutes after a stock adjustment. Any TTL on a business collection needs a `partialFilterExpression` scoping it to exactly the rows that may be deleted. `tests/indexDrift.test.js` fails CI on both mistakes.

## House rules

- Docs are curated (2026-07): `docs/` keeps only the cutover runbooks + `ENVIRONMENTS.md` + the consolidated audit (`docs/audit/09-CONSOLIDATED-2026-07.md`); the old `*_FIX.md`/`*_SUMMARY.md` sprawl and per-phase audit files were removed (recover from git history if needed). Code is the source of truth — verify any doc against it.
- Secrets never committed. Rotation runbooks in `SECRETS_ROTATION_GUIDE.md`.
- Don't touch `node_modules/` (untracked).

---

## Landmines / do-not-touch (quick reference)

- **Never fulfil an order on the client callback** — only on the signature-verified Razorpay webhook, through the one idempotent fulfilment routine.
- **Never make money optimistic** — price, totals, tax, discount, stock commitment, and payment status are server-confirmed before the UI commits.
- **Never trust client-sent prices/totals/discounts** — recompute server-side at checkout; validate coupons server-side.
- **Never let a product write skip the ES sync** — `updateMany`/`bulkWrite` bypass Mongoose hooks; enqueue the sync explicitly.
- **Never use `skip`/`offset` pagination** on catalog/search/orders — cursor/keyset only, always bounded.
- **Never leave cache to TTL after a price/catalog/SEO change** — purge Redis `route:*`/`public:*` + Cloudflare in the same write.
- **Never rate-limit on `req.ip` behind Cloudflare** — use `cf-connecting-ip`, or every user shares one bucket.
- **Never build quantity/reservation logic** against the coarse `in/low/out` enum, or revive `WarehouseInventory`, without a deliberate schema ADR.
- **Never render a historical order from live product/price docs** — orders snapshot their money at creation.
- **Never hand-roll `generateMetadata`** — wire into the config-driven SEO system.
- **Never push straight to `main`** — that IS the production deploy, and an admin push silently *bypasses* the PR + CI gate. Use a PR.
- **Never use `$ne` in a `partialFilterExpression`** — MongoDB rejects it, so the index is never built and nobody is told. Use `$type`.
- **Never put a TTL index on a subdocument array** — it deletes the whole parent document. Scope every TTL on a business collection with a `partialFilterExpression`.
- **Never `mongoose.connect()` in a script that imports models without `{ autoIndex: false }`** — it defaults to true and will build indexes against prod.
- **Never log per-request telemetry to MongoDB** — one insert per request made `rate_limit_events` 95% of the database and forced an Atlas tier upgrade. Redis holds the counters.
- **Never trust green CI as full coverage** — CI runs a curated subset; run the full suite locally.
- **Never smuggle an optimization** (cache layer, index, ES swap) into a feature diff — separate pass, tests standing guard.
- **Never introduce a second way to do something already established** (a rival cache, a Mongo-regex search beside ES, a bespoke queue) — use the existing primitive; replace it only as a measured upgrade.
- **Never hardcode the backend host in the frontend** — everything flows through `NEXT_PUBLIC_API_URL` + `next.config.ts` rewrites.
- **Never commit secrets**; anything in `NEXT_PUBLIC_*` is public.
- **Don't touch `node_modules/`.**