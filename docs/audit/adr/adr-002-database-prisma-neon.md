# ADR-002 — Database: stay on MongoDB (Atlas) vs. move to Prisma + Neon (Postgres)

_Status: Proposed · Date: 2026-06-15 · Auditor: Claude Code_

## Context

The original audit prompt assumed a possible move to **Prisma + Neon (PostgreSQL)**. Phase 0 discovery established that **the backend is already MongoDB**, via **Mongoose `^8.6`**, with **26 models** under `Back-end/server/models/`, hosted on **MongoDB Atlas** (connection in `config/db.js` with retry + Atlas IP preflight). Redis (`ioredis`) provides caching and `bullmq` queues; **Elasticsearch** provides product search. Data was migrated *into* Mongo from WooCommerce/WordPress.

So this is **not** a "which Postgres host" decision. It is a **paradigm migration**: document store → relational, plus an ODM→ORM rewrite. That reframing dominates the analysis.

## Options

### A. Stay on MongoDB / Atlas (recommended)
- **+** Zero migration risk — the system already runs in production on it.
- **+** 26 models, all controllers, repositories, and hundreds of operational scripts already speak Mongoose. No rewrite.
- **+** Atlas is managed; supports per-environment clusters/databases for `develop`/`main`.
- **+** Search already offloaded to Elasticsearch; caching to Redis — Mongo isn't doing the heavy query lifting alone.
- **−** Relational integrity (orders↔items↔inventory↔payments) is enforced in app code, not the DB.
- **−** Multi-document transactions are possible in Mongo but more awkward than in Postgres.

### B. Move to Prisma + Neon (Postgres)
- **+** Strong relational modeling + referential integrity for e-commerce (orders, payments, inventory).
- **+** Prisma type-safety; Neon DB branching per environment; serverless connection pooling.
- **−** **Full rewrite** of 26 models → Prisma schema, every query, every controller/repository, and a large fleet of scripts.
- **−** Touches **money/orders/payments** code paths — highest-risk surface to rewrite.
- **−** A **second** paradigm migration stacked on top of the in-progress WordPress migration → compounding risk.
- **−** **Neon's signature advantages mostly don't apply here:** serverless connection pooling matters when *serverless functions* open many short-lived connections; this backend is a **long-lived Express server on Railway** with its own pool. Branch-per-env is nice but Atlas already gives per-env clusters.

## Trade-offs summary

| Dimension | Stay MongoDB/Atlas | Move to Prisma+Neon |
|---|---|---|
| Migration effort | none | very high (rewrite) ✅cost |
| Risk to money/orders paths | none | high ⚠️ |
| Relational integrity | app-enforced | DB-enforced ✅ |
| Fit for current code | perfect | requires rewrite |
| Neon-specific wins (pooling/branch) | n/a | low value (non-serverless BE) |
| Maintainability long-term | good (single ODM) | good (typed ORM) |
| Timing vs WP migration | safe | compounds risk ⚠️ |

## Recommendation

**Stay on MongoDB / Atlas. Do not migrate to Prisma + Neon at this time.** The move is a document→relational paradigm rewrite of a working production system, concentrated on the riskiest (payment/order) code, executed during an already-in-flight WordPress migration. The benefits Neon is famous for (serverless pooling, branching) provide little value to a long-lived Express server, and Atlas already covers managed hosting and per-environment isolation.

This is a "right tool, wrong time / wrong premise" call — Postgres+Prisma would be a reasonable *greenfield* choice, but porting 26 models and the money paths is not justified by any pain identified in Phase 0.

For `develop`/`main` parity (roadmap Wave 0/2): use **separate Atlas databases or clusters per environment** with separate connection strings — no schema migration required.

**Revisit triggers** (when to reopen this ADR): recurring multi-document transaction pain on orders/inventory; complex relational reporting that fights the document model; or a future greenfield service where Postgres is the clean default.

## Confidence: **High** (for the current migration window).
What would raise it further: a one-page review of the 26 Mongoose models for any that are heavily relational/join-shaped today (would strengthen — or, if many, slightly weaken — the "stay" case), and confirmation of current Atlas tier/cost vs. a Neon equivalent for the record.
