# ADR-003 — WP↔Mongo data parity report

_Status: **RESOLVED** · Date: 2026-06-16 · Auditor: Claude Code · Closes ADR-003 item 1_

## Resolution (2026-06-16) — import re-run + cleanup
Re-ran `scripts/migrate-from-wordpress.js` (now with HTML cleaning + category linking)
and added `scripts/dedup-wp-products.js`. Final verified state:

| Check | Before | After |
|---|---|---|
| WP-published products present | 874/899 (25 by externalId) | **899/899 — missing 0** |
| Duplicate WP-id product docs | 13 | **0** |
| Titles with HTML tags / entities | 13+ | **0** |
| Active products with 0 categories | 13 | **0** |
| Images on WP domain / `wp_` placeholders | 0 / 0 | 0 / 0 (all Cloudinary) |
| Category titles with HTML/entities | several | **0** |

What changed in the importer:
- **HTML cleaning** (`htmlToText`, cheerio): decode entities (`&amp;`→`&`, `&#8211;`→`–`) + strip tags on name/tags; decode + strip + keep newlines on descriptions. Matches what WordPress rendered.
- **Category linking**: resolve WP category → Mongo `Category._id` (by wpId → slug → **name**), so new products show on category pages. Name fallback handles WordPress's duplicate-name categories.
- **Robust matching + id convergence**: match on `wpId | externalId | slug`; write both `externalId` and `wpId` = WP id.
- **Dedup**: 13 products existed as twin docs (one categorized w/ suffixed slug, one empty w/ clean slug). Merged into one clean-slug doc, deleted the empty twin.

**Note — WordPress-side data quality:** WP itself has 7 duplicate-name categories
(e.g. two "Front Lip": id 5847/`front-lip-2` + id 168/`front-lip`). Mongo holds one
(unique name index); products referencing either id resolve to it by name. Worth
cleaning the dups in WP before final decommission. The original 25/30/7 "gap" was
mostly stale `externalId` tagging + these WP duplicates, not lost data.

---

_Original diagnosis below (read-only snapshot)._

## Method
Live counts pulled, no writes:
- **WP source of truth:** WooCommerce REST `wc/v3` on `https://autobacsindia.com` (`X-WP-Total` headers + full id/slug pull).
- **Mongo:** Atlas `cluster0…/autobacs`, collections `products`, `categories`, `brands`.
- Product key = WP `id` ↔ Mongo `externalId`. Category key = `slug` (Mongo categories store **no** `externalId`).

## Headline

| Entity | WP (published) | WP (all status) | Mongo total | Mongo WP-linked | Verdict |
|---|---|---|---|---|---|
| Products | **899** | 1120 | 938 | 904 | 25 missing, 30 orphan |
| Categories | **419** | — | 413 | 0 w/ externalId | 7 missing, 1 orphan |
| Brands | — | — | 54 | — | — |

Mongo also holds **34 products with no `externalId`** (locally created, not from WP — expected).

Field health (Mongo products): missing slug **0**, zero/no price **0**, no category **33**, no images **0**.

## Gap 1 — 25 WP-published products missing from Mongo (P1)
All sit in WP id range **27127–27714** = the **newest** products (Thar Roxx, Fronx, Innova Hycross, latest 2024-25 kits). Last Mongo import ran **2026-01-16** (`import-metadata.json`).
**Root cause: import is stale — never re-run after these were added to WP.** Not a logic bug; a freshness gap.
Full list: see `/tmp` pull / re-run query. Examples:
- 27714 Ironman Foam Cell Suspension Kit for Mahindra Thar Roxx
- 27567 `MP7-0114-L015` Profender Drift Series Full Suspension Kit for Toyota …
- 27226 Fortuner BMW Style Headlights 2021+
- 27127 Tithum Body Kit for Fortuner Legender

## Gap 2 — 30 Mongo products orphaned (P2 — review)
Mongo `externalId` **not in WP-published set**, all WP id range **9475–24221** (older), all `isActive: true` in Mongo.
**Likely cause: unpublished/trashed in WP after import, but still active+live in Mongo.** Either (a) discontinued in WP → should be deactivated in Mongo, or (b) intentionally WP-only-removed but kept live. **Needs business call per item.** Examples: 24221 BMW X6 conversion, 22005 Automatic side steps Hilux, 18528 BAZARD Floor Mat Hilux.

## Gap 3 — 7 WP categories missing from Mongo (P2)
`automatic-side-steps-spoiler`, `digital-climate-control-panel-accessories`, `front-lip`, `metal-pedal-kit-accessories`, `projector-headlights`, `roof-carrier`, `tough-dog-brands`.
Several map directly to the 25 missing products → same stale-import root cause. `tough-dog-brands` looks brand-shaped (may live under `brands`, count 54).

## Gap 4 — vehicle-fitment mappings (P3, separate)
Latest `reports/vehicle-product-migration-*.json`: 890 processed, **770 mapped → 120 unmapped**, `errors: []`. Fitment coverage, independent of product parity.

## Schema note
Mongo `categories` carry **no `externalId`** → WP↔Mongo category reconciliation is slug-only and fragile. Adding `externalId` to `Category` would make future parity deterministic (feeds D3).

## Verdict
Migration is **~97% complete and structurally sound** (prices/slugs/images clean). Remaining is **freshness + lifecycle sync**, not broken transforms:
1. Re-run import → pulls the 25 new products + 7 categories. (fixes Gap 1 & 3)
2. Reconcile 30 orphans → deactivate discontinued, keep the rest. (Gap 2, needs sign-off)
3. Re-run vehicle fitment mapper for the 120. (Gap 4)
4. Then proceed to ADR-003 step 4 residue removal.

**Re-run this report after step 1** to confirm 899↔899 before decommissioning WP.
