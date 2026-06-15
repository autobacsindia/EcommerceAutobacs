# ADR-003 — WordPress migration strategy

_Status: Proposed · Date: 2026-06-15 · Auditor: Claude Code_

## Context
The store originated on **WooCommerce/WordPress**. Product/category/data has **already been migrated into MongoDB** via an import-service fleet (`woocommerceMigrationCli.js`, `productImportService`, `categoryImportService`, `brandProductImportService`, `migrationOrchestrationService`). The Next.js frontend reads the **Mongo-backed Express API**, not `wp-json` — so the runtime is **already decoupled** from WordPress. What remains is **code + schema residue**, not a live WP dependency:
- `@woocommerce/woocommerce-rest-api` dependency + import code in the prod service layer (B4).
- Stale schema fields/indexes (`externalId` "WordPress sync", `WORDPRESS_API_*` env) (D3, S4).
- Many WP-related one-off scripts and docs.

## Options
- **A. Big-bang cutover:** flip DNS/host, retire WP entirely in one step.
- **B. Strangler-fig (incremental):** keep WP reachable for fallback/SEO while the new stack serves traffic; retire WP piece by piece. **(Effectively already in progress.)**

## Trade-offs
| | Big-bang | Strangler-fig |
|---|---|---|
| Risk | high (no fallback) | low (gradual) ✅ |
| SEO/redirects | must be perfect day one | can validate incrementally ✅ |
| Effort now | high burst | low (mostly cleanup) ✅ |
| Rollback | hard | easy ✅ |

## Recommendation
**Finish the strangler-fig migration that is already ~90% done — do not do a big-bang.** Concrete close-out steps (roadmap Wave 3):
1. **Verify data parity** WP vs Mongo (counts per category/brand; spot-check products) using existing `verify-*` scripts — record a signed-off report.
2. **SEO preservation:** map every WP URL → new URL; add 301 redirects (Next `middleware.ts`/`next.config` or edge). Submit updated sitemap (a sitemap implementation already exists). Preserve canonical tags.
3. **Decommission WP** only after parity + redirects verified: take a final WP export/backup, then shut it down.
4. **Remove residue:** isolate then delete import services behind a flag, drop `@woocommerce/woocommerce-rest-api`, remove `externalId`/`WORDPRESS_API_*` fields/env, archive WP scripts/docs.
5. **Rollback safety:** keep the final WP backup + DNS revert path documented in `/docs/runbook.md` for a defined window.

## Confidence: **High.**
What would raise it: a concrete WP-vs-Mongo parity report (item 1) and a complete old→new URL redirect map (item 2), which are the only real remaining risks (SEO + data completeness).
