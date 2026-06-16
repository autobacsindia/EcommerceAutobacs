# WordPress → MongoDB migration runbook

How to (re)sync WooCommerce product/category data into the production MongoDB
**without creating duplicates** in the admin dashboard.

## Why duplicates happened before (and won't now)
Each WP product has one id. Historically it was stored in **two** Mongo fields
(`externalId` as string, `wpId` as number) by two different importers, and when a
product's clean slug was already taken the second importer saved it under a
suffixed slug (`…-27118`). Result: two docs for one product → two rows in admin.

The importer now prevents this:
- **Matches an existing doc on `wpId` OR `externalId` OR `slug`** before writing, and
  **updates that doc in place** (never blind-inserts a second copy).
- **Writes both `externalId` and `wpId` = the WP id**, so the two fields converge.
- `scripts/dedup-wp-products.js` merges any legacy twins that still exist.

So a re-run is **idempotent**: same product → same one doc → one admin row.

## Prerequisites
Run from `Back-end/server`. `.env` must contain:
- `MONGO_URI` (points at the target DB — check it's the right one!)
- `WORDPRESS_SITE_URL`, `WORDPRESS_API_KEY`, `WORDPRESS_API_SECRET`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (for images)

## The safe procedure (always in this order)

```bash
cd Back-end/server

# 1. DRY RUN — writes nothing. Review the would-insert / would-update counts
#    and the before/after cleaning samples. Inserts should be only genuinely
#    new products; everything else should be "update".
node scripts/migrate-from-wordpress.js --dry-run

# 2. REAL RUN — idempotent upserts + image migration to Cloudinary.
node scripts/migrate-from-wordpress.js

# 3. DEDUP CHECK — should report "Duplicate WP ids found: 0".
#    If it finds any, review the dry-run output, then apply.
node scripts/dedup-wp-products.js          # dry run
node scripts/dedup-wp-products.js --apply  # only if pairs were found

# 4. Read Phase 4 "Verification" in the step-2 output. All must hold:
#    Images still on WP domain : 0
#    Images with wp_ public_id : 0
#    Product names w/ HTML/ents: 0
#    Category names w/ HTML/ent: 0
#    Active products, 0 categs : 0
```

If anything is non-zero, the run is safe to repeat — every operation is idempotent.

## What the importer does to each product
- Cleans `name` / `description` / `shortDescription` / `tags`: decodes HTML entities
  (`&amp;`→`&`) and strips tags, matching what WordPress rendered.
- Links WP categories → Mongo `Category._id` (so the product appears on category pages).
- Downloads WP images → Cloudinary once (deterministic public_id; re-runs overwrite,
  never duplicate). Already-migrated Cloudinary images are skipped.

## Notes / known WP-side data quality
- WP itself has a few **duplicate-name categories** (e.g. two "Front Lip") and ~30
  **orphan products** (unpublished in WP but still active in Mongo). The importer
  handles the category dups by aliasing; orphans are left as-is. Clean these in
  WordPress before final decommission.
- SKUs: most WP products have **no SKU**; Mongo shows generated `WP-<id>` placeholders
  for those. The 6 products with a real WP SKU keep it. This is expected, not data loss.

Full parity evidence: `docs/audit/adr/adr-003-parity-report.md`.
