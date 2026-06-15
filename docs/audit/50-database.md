# 50 — Database & Data Migration

_Phase 1. **Engine: MongoDB (Atlas), via Mongoose `^8.6`.** This is NOT Postgres — see ADR-002, which re-scopes the prompt's Prisma+Neon assumption._

## Current state
- **26 Mongoose models** (`Back-end/server/models/`): core commerce — `Product, Category, Brand, Order, Payment, Cart, User, Review, Wishlist, ReturnRequest, ProductQuestion, Vehicle, Warehouse, WarehouseInventory, DeliveryZone, UserLocation, Consultation, Contact, Article, MediaItem`; infra/ops — `AuditLog, NotificationLog, WebhookEvent, ImportJob, RateLimitEvent, AdaptiveThrottlingProfile`.
- Connection: `config/db.js` — `connectWithRetry()` + Atlas IP preflight; extensive pool-health event logging in `server.js`.
- Caching: Redis (`ioredis`); Search: Elasticsearch (`elasticsearchService.js` 928 LOC); Queues: BullMQ.

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| D1 | P1 | No formal migration tool; schema changes via ad-hoc scripts (`fix-cart-indexes.js`, `scripts/ensure-production-indexes.js`, dozens of `fix-*/sanitize-*` scripts) | No declarative schema/index migration system → index drift across environments | Adopt `migrate-mongo` (or similar) with versioned, idempotent migrations checked into repo |
| D2 | P1 | Prior memory: `ensure-production-indexes.js` not yet run on prod | Production indexes may be missing → slow queries / scans | **USER ACTION** — run `railway run node scripts/ensure-production-indexes.js` (idempotent) |
| D3 | P2 | `externalId` "WordPress sync" index + `WORDPRESS_API_*` legacy refs (prior memory) | Stale WP-coupled schema fields linger after WP retirement | Plan removal of `externalId`/WP fields once migration verified (feeds ADR-003) |
| D4 | P2 | Referential integrity is app-enforced (Mongoose refs), not DB-enforced | Order↔Product↔Inventory↔Payment consistency relies on code | Add Mongoose validation + transactions on money paths; document invariants |
| D5 | P2 | Per-env DB isolation unconfirmed | `develop`/`main` must not share a database | Use separate Atlas DBs/clusters per env with distinct connection strings (no schema migration needed) |
| D6 | P3 | `complete-wp-data.json` (committed), `detailed-wp-products.json`, product-mapping dumps in repo | Large data dumps tracked in git | Move to object storage / gitignore; remove from working tree |

## WordPress data shape & migration status
- Source was **WooCommerce/WordPress**, migrated **into MongoDB** via the import service fleet (`woocommerceMigrationCli.js`, `productImportService`, `categoryImportService`, etc.). Migration appears **largely complete** (products/categories live in Mongo; many `verify-*` and `cleanup-wordpress-*` scripts).
- Remaining WP coupling is **code + stale fields**, not live data dependence (frontend already reads the Mongo-backed API). This is favorable for finishing the WP cutover.

## Prisma + Neon decision (feeds ADR-002)
- Moving Mongo→Postgres is a **paradigm rewrite** of 26 models + money paths during an active WP migration. **Recommendation: stay on Mongo/Atlas** (see ADR-002). Neon's serverless-pooling/branching wins don't apply to a long-lived Express server.

## Open items
- Inventory which models are heavily relational/join-shaped (would inform any future Postgres reconsideration).
- Confirm current Atlas tier + cost for the record.
