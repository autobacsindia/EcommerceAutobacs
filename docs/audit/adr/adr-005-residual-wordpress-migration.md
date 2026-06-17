# ADR-005 — Residual WordPress → Mongo Migration (customers, orders, reviews, blog)

Status: Accepted (2026-06-17)
Supersedes nothing. Extends [adr-003-wordpress-migration-strategy](./adr-003-wordpress-migration-strategy.md),
which covered **products / categories / brands / images only**. This ADR covers everything else still
in WooCommerce, plus the cutover that lets WordPress be decommissioned without breaking customers,
the sales team, or marketing.

## Context

`services/wordpressSyncService.js` migrates products, categories, brands and images at full parity.
Still living only in WooCommerce / WordPress:

| Entity | Target | Why it matters | Blocker found |
|---|---|---|---|
| Customers (`wc/v3/customers`) | `User` | login continuity | `passwordHash` required; WP uses phpass, not bcrypt; no `wpId` |
| Orders (`wc/v3/orders`) | `Order` | **sales + marketing dashboard reads revenue/customers straight from Mongo Orders** — empty until migrated | `user` required; no `wpId`/`source` |
| Reviews (`wc/v3/products/reviews`) | `Review` | product star ratings / social proof | `user` + `comment` required → blocks guest WC reviews |
| Posts/Pages (`wp/v2/posts`,`pages`) | `Article` | SEO traffic / content | no `wpId`, no old-URL redirect map |
| Coupons (`wc/v3/coupons`) | — | promos | **no model exists** |
| Traffic analytics | dashboard | marketing | **not in WC REST** — lives in a WP plugin |

`services/dashboardAnalyticsService.js` aggregates revenue, customer counts and top-products directly
from Mongo `Order`/`User`. Therefore migrating orders+customers *is* the sales/marketing analytics fix;
no separate "analytics import" exists for historical numbers.

## Decisions

1. **Passwords — force reset on first login.** Import customer profiles with no password. Migrated users
   carry `migratedFromWp:true` + `mustResetPassword:true`; first login routes them through the existing
   reset/magic-link flow. phpass→bcrypt cannot be carried; we accept one reset email per customer over
   storing legacy hashes.
2. **Coupons — deferred, not in this migration.** Coupon discount logic touches checkout (highest blast
   radius) and local WP dumps contain none. Verify live count first
   (`GET /wc/v3/coupons?per_page=1` → `X-WP-Total`). If non-trivial, build a `Coupon` model + `orderService`
   apply hook as its **own** isolated ADR. Marketing re-enters active promos by hand in the interim.
3. **Analytics — PostHog, forward-looking, separate phase.** Historical revenue comes from migrated orders
   in the existing dashboard. PostHog (`posthog-js` client funnel events + `posthog-node` server order
   events, reverse-proxied via a Next rewrite to dodge adblockers) is net-new behavioral analytics, not a
   migration. No backfill of history into PostHog.
4. **Migrations are additive and non-destructive**, mirroring `wordpressSyncService` exactly: `wcGetAll`
   pagination, dry-run default, `--apply` guard, idempotent upsert keyed on `wpId`, `ImportJob` tracking,
   env-gated, never deletes/deactivates. Historical orders are flagged `source:'woocommerce'` and excluded
   from live fulfilment queues but included in analytics.

## Plan

### Phase A — Schema prep (additive, non-breaking)
- `User`: `wpId` (sparse-unique), `migratedFromWp`, `mustResetPassword`; `passwordHash` required **unless** `migratedFromWp`.
- `Order`: `wpId` (sparse-unique), `source:'web'|'woocommerce'` (default `web`), `legacyStatus`; `user` and `items.product` required **unless** `source==='woocommerce'`.
- `Review`: `wpId` (sparse-unique), `guestName`, `guestEmail`; `user`/`comment` required **unless** `wpId`; `{product,user}` unique index made partial (only when `user` set).
- `Article`: `wpId` (sparse-unique), `wpUrl` (old permalink, for redirects).
- Add the new indexes to `scripts/ensure-production-indexes.js`.

### Phase B — Importers (`services/`, CLI wrappers in `scripts/`)
1. Customers → User (profile + addresses, no password, claim flow). Email collision → merge into existing user.
2. Orders → Order (`source:'woocommerce'`). Link items to Product by `wpId`, snapshot name/price if product gone. Link to user by `wpId`→email→guest.
3. Reviews → Review (carry `isApproved`), then recompute product rating aggregates.
4. Posts/Pages → Article (clean HTML via shared `htmlToText`, rewrite inline media URLs → Cloudinary).

### Phase C — Don't break the flow
- 301 redirect map old WP permalinks → Next routes (products, categories, `/blog/*`, pages) from `wpSlug`/`wpUrl`, wired in `next.config.ts`. Protects search rankings + ad landing pages.
- PostHog wiring (its own PR).

### Phase D — Cutover
- Per-entity parity diff (`X-WP-Total` vs Mongo `wpId` count), like products.
- Then delete WP cron + service + one-off `scripts/*wp*`/`import-*` files + WP env/deps (transitional, see [[wp-migration-status]]).

## Risks
- Password reset = one email blast per customer; sequence with go-live comms.
- `Coupon` is net-new checkout logic; keep fully isolated.
- Order import must use the guest path / placeholder so it never trips the `user`-required validator on live orders.
