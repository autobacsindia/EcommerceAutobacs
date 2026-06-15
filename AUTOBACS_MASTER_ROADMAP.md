# Autobacs India — Premium E-Commerce Platform: Master Roadmap

**Prepared for:** DevOps / Engineering Team, Autobacs India
**Scope:** WooCommerce → Next.js migration completion, product-data QA, UI/UX revamp (premium/Zara-tier), production-grade hardening, Git workflow & CI/CD
**Date:** June 2026

---

## 1. Current State Assessment

### 1.1 What you actually have (this is more mature than "in-progress junior dev project")

After reviewing the repo (`Front-end/web` = Next.js 15 / React 19 / Tailwind v4, `Back-end/server` = Node/Express + MongoDB Atlas), the codebase is **substantially built out**, not a skeleton:

- 42+ frontend routes already exist: home, shop, categories, products, brands, vehicles, model pages, cart, checkout, wishlist, compare, orders, profile, auth (login/register/verify/reset), consultation, super-cars, warranty, returns, FAQ, careers, etc.
- A **full admin dashboard** already exists: products, categories, brands, vehicles, warehouses, orders, refunds, returns, users, analytics, reviews, questions, media, workflows, consultation, settings.
- Backend has: JWT auth, rate limiting, Helmet security headers, Sentry + LogRocket monitoring, Redis caching, Elasticsearch indexing, Cloudinary image hosting, Razorpay payments, BullMQ-style queue, automated test suites (Jest, Playwright e2e), Artillery load testing scripts.
- A prior **production audit was already completed** (`AUDIT_IMPLEMENTATION_SUMMARY.md`, score 4/10 → 7/10) — CORS hardened, TLS fallback removed, cache middleware added, DB index script written, env validation script written.
- **WooCommerce has already been functionally retired in code** — commit `0badb895 "retire WordPress/WooCommerce — product data fully in MongoDB"`. The new site is the system of record now.
- CI workflows already exist (`ci-frontend.yml`, `ci-tests.yml`, `ci.yml`, `deploy.yml`) targeting Railway.
- Deployment is on **Railway** (frontend + backend as separate services), MongoDB Atlas as DB.

**Bottom line:** this is closer to "late-stage beta that needs QA, polish, and a UI overhaul" than "early prototype." That changes the roadmap significantly — your priority is **stabilization + premium redesign + data QA**, not rebuilding from scratch.

### 1.2 What the WooCommerce site (autobacsindia.com / "ROAVION") tells us about scope

- ~900 products across categories: **Accessories, Exterior, Interior, Body Kits, Performance, Suspension, Audio/Infotainment, Lighting**, plus brand collections (Profender, Brembo, Borla, Kahn Design, Dobinsons, Ironman 4x4, Lightforce, Remus, Hella, etc.)
- Vehicle-based browsing is core to the UX: "Explore by Vehicle" (Hilux, Thar, D-Max, Jimny, Wrangler, etc.) — this vehicle-model-first navigation is already replicated in the new site (`/model`, `/vehicles`, `/super-cars`).
- Price points run from ~₹26,000 to ~₹290,000 — this **is** a premium/luxury accessories business. The current WooCommerce theme looks like a generic WordPress/Elementor storefront, which undersells the product quality. This validates your instinct for a Zara-tier visual overhaul.

### 1.3 Known issue inventory (from existing repo docs — read these before doing new work)

The repo already contains ~25 incident/fix documents. Key ones the new developer (or Claude Code) should read first:
- `SECURITY_STATUS_REPORT.md` — secrets were exposed in **git history** (MongoDB URI, Google Maps keys, SendGrid key). These were removed from current files but remain in history — **must be rotated** (see §4).
- `PRE_LAUNCH_CHECKLIST.md` / `AUDIT_IMPLEMENTATION_SUMMARY.md` — authoritative pre-launch gate.
- `GUEST_CHECKOUT_*.md` (8 files) — guest checkout had multiple iterations of bugs (cart 401s, address button, empty cart). Verify final state works end-to-end before building on top of it.
- `RAZORPAY_GUEST_PAYMENT_FIX.md`, `RAZORPAY_SETUP.md` — payment gateway still on test keys per checklist.
- `CHUNKLOAD_ERROR_FIX.md`, `CART_404_ERROR_REAL_FIX.md` — Next.js chunk-loading/caching issues on Railway; worth re-testing after the redesign since new builds can reintroduce this class of bug.
- `Back-end/server/product-mapping-results/` and `reports-mapping/` — this **is** your product migration audit trail (see §2).

---

## 2. Product Migration QA (900 products from WooCommerce → MongoDB)

### 2.1 What's already been done

The junior developer already ran a structured migration + validation pass:
- **852 of ~900 products validated** against category mapping rules.
- **815 valid**, **37 invalid/missing category assignments** (e.g., 70mai dashcams, WARN winches, Dr. Nano shocks, Remus exhausts — all assigned brand names as categories instead of real categories like "Performance" or "Audio").
- 934 products had SKUs auto-generated (was previously missing entirely).
- 462 duplicate product documents were removed across 8 category passes.
- Category distribution looks heavily skewed: Body Kits (372) and Accessories (356) dominate; Audio shows **0** despite ~72 audio products being processed in Phase 3 — this is a red flag worth checking first (likely got remapped into Accessories/Lights and lost its category, or the validation report is stale).

### 2.2 QA Checklist — hand this to the developer / Claude Code

This is a **methodology document**, not yet executed against live data (no credentials were available in this session). Run it as a structured pass:

**A. Reconciliation pass (quantity & identity)**
1. Export the full WooCommerce product list via WP REST API (`/wp-json/wc/v3/products?per_page=100&page=N`) — capture: ID, SKU, name, price, regular/sale price, stock status, categories, brand attribute, images, short description, full description, weight/dimensions if set.
2. Export the full MongoDB `products` collection (same fields + `externalId`/`wooId` if it was preserved during migration — check `import-migrated-data.js` and `csv-import-products.js` to confirm whether the original WooCommerce ID was retained as a mapping key).
3. Produce a diff report:
   - Products in WooCommerce but **missing** in MongoDB.
   - Products in MongoDB but **not traceable** to a WooCommerce source (could be legitimately new, but flag for review).
   - Products present in both but with **price mismatches** (critical — premium price points mean even small errors are high-value).
   - Products with **missing images**, **broken Cloudinary URLs**, or images still pointing to `autobacsindia.com/wp-content/uploads/...` (the migration commit log mentions a Cloudinary migration pass — confirm 100% coverage, not partial).

**B. Category & taxonomy integrity**
4. Re-run `validate-product-categories-with-mapping.js` (already exists in `Back-end/server`) and resolve all 37 currently-flagged invalid assignments — these are brand names sitting in the category field.
5. Investigate the **Audio: 0** anomaly — confirm whether audio/infotainment products exist and are simply mis-tagged, or were dropped.
6. Verify every product maps to at least one of the 8 top-level categories AND (where applicable) a vehicle model — this powers the "shop by vehicle" navigation that's central to the WooCommerce UX.

**C. Content quality pass**
7. Spot-check a stratified random sample (not just first N): 5 products per category (40 total) for:
   - Description completeness/formatting (WooCommerce descriptions often contain raw HTML/shortcodes — check for leftover `[shortcode]` artifacts or broken `<div>` soup in MongoDB `description` fields).
   - Correct SKU (the auto-generated SKU algorithm — first 8 chars of name + last 4 of Mongo ObjectId — can produce **collisions** for products with similar names; run a SKU uniqueness check across all 900).
   - Variant/attribute data (size, color, vehicle compatibility) — WooCommerce variable products may not have migrated variants correctly; check if the new schema even supports variants (`models/Product.js`).

**D. Inventory & pricing**
8. Stock quantities and stock status (in stock / out of stock / backorder) — confirm these synced, not just product metadata.
9. Sale prices / discount logic — WooCommerce shows strikethrough "was/now" pricing (visible on the homepage). Confirm the new product schema and PDP support this, and that active sales carried over (or were intentionally reset).

**D. Deliverable**
10. Produce a single `PRODUCT_MIGRATION_QA_REPORT.md` with: total counts both sides, reconciliation diff (CSV attached), category-fix list, SKU collision list, image-coverage %, and a sign-off checklist before this is considered "production data."

> **Suggested script** (for the developer to build, not run now): a Node script in `Back-end/server/scripts/migration-qa/` that:
> - pulls WooCommerce products via the WC REST API (read-only, use `consumer_key`/`consumer_secret` from WooCommerce → Settings → Advanced → REST API),
> - pulls MongoDB products,
> - matches on SKU first, then fuzzy-matches on slugified name as fallback,
> - outputs the diff CSV + a console summary.
> This is mechanical and well-suited to be Claude Code's first task on this repo.

---

## 3. UI/UX Revamp — Premium / "Zara, not Flipkart" Direction

### 3.1 Current state vs. target

The current dark theme (`globals.css`) is actually a reasonable **starting point** — near-black background (`#080808`), blue accent (`#3B9EE8`), gold accent (`#EF9F27`), chrome/steel grays. That's an automotive-premium palette already. The gap is likely in **layout density, typography, imagery, and motion** — the things that separate "dark Bootstrap theme" from "Zara/Porsche Design/Rivian-tier."

### 3.2 Design principles to apply

1. **Whitespace is luxury.** Premium sites use generous negative space, large product photography, and fewer competing elements per screen. Reduce visual noise — fewer simultaneous CTAs, badges, and banners than a Flipkart/Myntra layout.
2. **Typography hierarchy.** Currently using DM Sans + Barlow Condensed (good choices — condensed sans for automotive feels right). Establish a strict type scale (e.g., 12/14/16/20/28/40/64px) and use the condensed font *only* for large display headings/category labels, DM Sans for body — avoid mixing on the same line.
3. **Photography-first product pages.** Large, full-bleed or near-full-bleed product imagery with a thin product info rail (Zara pattern), not a 50/50 split with cluttered "specs table" look. Use Cloudinary transformations for consistent aspect ratios and on-the-fly responsive sizing (already integrated — leverage it more aggressively: `f_auto,q_auto,w_auto`).
4. **Motion with restraint.** Framer Motion is already a dependency — use subtle fade/slide-in on scroll, smooth page transitions, micro-interactions on hover (image zoom, color-swatch preview), but avoid bouncy/playful animation — premium = slow, deliberate easing curves (e.g., `cubic-bezier(0.16, 1, 0.3, 1)`).
5. **Navigation: editorial, not exhaustive.** Replace dense mega-menus (common on Flipkart-style sites) with a curated mega-menu: large category imagery tiles + "shop by vehicle" as a primary nav mode (this is already your differentiator vs generic auto-parts stores).
6. **Color discipline.** Reserve gold (`--brand-gold`) for genuinely premium/limited signals (e.g., "Limited Edition", price, sale badges) — not for generic UI chrome. Blue stays as the primary interactive/link color. Avoid red/green "sale" badges typical of mass e-commerce; consider monochrome badges with subtle gold accent instead.
7. **Trust & craft signals.** Premium clientele buying ₹1L+ suspension kits and body kits expect: brand storytelling per product (origin, materials, fitment guarantee), high-res install/fitment photos, certifications/warranty badges, and a "concierge" feel — your existing `/consultation` page is a great asset here; make it more prominent (e.g., a persistent "Talk to a Specialist" CTA for high-value items).

### 3.3 Page-by-page priorities (highest impact first)

| Priority | Page | Key changes |
|---|---|---|
| 1 | **Homepage** | Hero: full-bleed video/image of a styled vehicle, minimal copy, single CTA. Replace brand-logo strip with a curated "Featured Brands" carousel (fewer, larger logos). "Shop by Vehicle" as a visual model-selector (car silhouettes/photos), not a text list. |
| 2 | **Product Listing (PLP)** | Larger product cards (3-4 per row desktop, not 4-5), hover-to-second-image, sticky filter sidebar with vehicle-compatibility filter as the top filter (unique to automotive), price displayed prominently without clutter. |
| 3 | **Product Detail (PDP)** | Image gallery dominant (60-70% viewport), sticky "buy box" with price/CTA, fitment/compatibility table, accordion for description/specs/shipping/warranty, related products as "Complete the Build" cross-sell (you already have a complementary-products feature per package.json — surface it prominently). |
| 4 | **Cart/Checkout** | Single-page or 2-step checkout (already likely Next.js app router based), trust badges near payment, order summary always visible (sticky on desktop). |
| 5 | **Vehicle/Model pages** | This is your unique value vs Flipkart/Myntra — make `/model/[slug]` pages rich: hero image of that vehicle, curated product sets by category for that model, "build your [Hilux/Thar]" narrative framing. |
| 6 | **Admin dashboard** | Lower priority for "premium feel" (internal tool), but ensure it's fast and usable — this is where the team will manage 900+ SKUs daily. |

### 3.4 Design system deliverables (recommend before dev starts on UI)

1. **Figma (or similar) design system file**: color tokens (map to your existing CSS variables), type scale, spacing scale (4/8px grid), component library (buttons, cards, badges, filters, modals) in both light/dark where applicable.
2. **Reference moodboard**: Zara.com, Porsche Design, Rivian, Aritzia, COS — pull specific patterns (grid density, image cropping, typography pairing) into annotated examples.
3. A **"Do Not" list** for the developer — explicitly call out anti-patterns to avoid (countdown timers, flashing "X people viewing this" banners, dense coupon-code bars, excessive badge clutter) since these read as "mass market."

---

## 4. Production-Grade Roadmap (matching Flipkart/Myntra functional depth)

Organized by phase. Phase 0 items are blockers; everything else can run in parallel workstreams once Phase 0 is clear.

### Phase 0 — Security & Stabilization (Week 1) — **DO NOT SKIP**
- [ ] Rotate all secrets exposed in git history (MongoDB URI/password, Google Maps keys, SendGrid key, Cloudinary, JWT secret, OAuth secrets, Razorpay) — see `Back-end/server/SECRETS_ROTATION_GUIDE.md`.
- [ ] Switch Razorpay from test → live keys only when ready for real transactions (keep test mode during UI revamp).
- [ ] Run `validate-production-env.js` and `ensure-production-indexes.js`.
- [ ] Re-verify guest checkout end-to-end (history of 8 separate fix docs suggests fragility — write/confirm a Playwright e2e test that covers guest cart → guest checkout → COD and Razorpay).
- [ ] Confirm `.env` is genuinely absent from working tree on the developer's clone (check `git status` and re-confirm `.gitignore` coverage).

### Phase 1 — Product Data Integrity (Weeks 1-2, parallel with UI design)
- [ ] Execute the migration QA from §2.
- [ ] Fix the 37 mis-categorized products + resolve the Audio=0 anomaly.
- [ ] De-duplicate/verify SKU uniqueness across all ~900 products.
- [ ] Backfill missing descriptions/images; standardize image aspect ratios via Cloudinary transformations.
- [ ] Decide on **variant/attribute model** (size, color, vehicle-fitment) and migrate WooCommerce variable products accordingly if not already supported.

### Phase 2 — UI/UX Revamp (Weeks 2-6)
- [ ] Design system + moodboard sign-off (§3.4).
- [ ] Rebuild homepage, PLP, PDP per §3.3 — component-by-component, behind a feature flag or on the `develop` branch so `main`/production stays stable.
- [ ] Visual regression testing (Playwright already present — add snapshot tests for key pages).
- [ ] Accessibility pass — `jest-axe` and `@axe-core/react` are already installed; run them and fix violations (premium ≠ inaccessible; also an SEO/legal consideration in India under upcoming digital accessibility norms).

### Phase 3 — Commerce Feature Parity with Myntra/Flipkart (Weeks 4-10, can overlap Phase 2)
Audit each against current repo (✅ = appears to exist already based on routes/admin found; ❗ = verify/likely missing):
- ✅ Wishlist (`/wishlist`)
- ✅ Compare products (`/compare`)
- ✅ Order tracking (`/track`, `/orders`)
- ✅ Returns/refunds (admin has `/returns`, `/refunds`)
- ✅ Reviews/Q&A (admin has `/reviews`, `/questions`)
- ✅ Multi-warehouse inventory (admin `/warehouses`)
- ❗ **Search**: Elasticsearch is integrated (`setup-elasticsearch.js`, `reindex-products.js`) — confirm search-as-you-type, typo tolerance, and faceted search (by vehicle, brand, price, category) are live on the frontend, not just backend-ready.
- ❗ **Recommendations**: "complementary products" feature exists per package.json — confirm "frequently bought together," "you may also like," and "recently viewed" (the latter pairs well with Dexie, which is already a dependency — likely for offline/local cart or recently-viewed storage).
- ❗ **Promotions/Coupons**: check if a coupon/discount engine exists; if not, this is a common gap vs Myntra/Flipkart.
- ❗ **Multi-address book** for users, saved payment methods (Razorpay tokenization).
- ❗ **Push notifications / abandoned cart emails** — SendGrid is integrated; confirm transactional + marketing email flows (order confirmation, shipping update, abandoned cart, back-in-stock).
- ❗ **Shiprocket/Delhivery integration** — flagged as "low priority" in the existing audit but is table-stakes for Flipkart-level fulfillment; prioritize once core UI is done.
- ❗ **PWA**: `@ducanh2912/next-pwa` is installed — confirm it's configured and the site is installable/offline-tolerant for product browsing.
- ❗ **Analytics**: GA4/Search Console not yet configured per pre-launch checklist — needed for any serious optimization work.

### Phase 4 — Performance & SEO (Weeks 6-8, parallel)
- [ ] Lighthouse audit on key pages (target 90+ on Performance/SEO/Accessibility for a premium brand).
- [ ] Image optimization audit (Sharp + WebP conversion scripts already exist — ensure they run as part of the image pipeline, not ad hoc).
- [ ] JSON-LD structured data for Product, Breadcrumb, Organization schemas (flagged as medium priority in existing audit — directly impacts rich results in Google for ₹1L+ products).
- [ ] Core Web Vitals monitoring via Sentry performance or Vercel/Railway analytics.
- [ ] Server Components audit — some refactors already happened (`extract Header and ProductCard to Server Components`); continue converting client-heavy pages.

### Phase 5 — Claude-Powered Operational Tooling (ongoing, your differentiator)
This is where "the power of Claude and its features/connectors" comes in concretely:
- **Claude Code** as the primary dev agent for this repo — given the repo already has extensive `.md` runbooks, Claude Code can be pointed at specific fix-docs to verify/extend them.
- **MCP connectors** worth connecting once available: GitHub (PR review automation), Slack (deploy/error notifications), Google Analytics/Search Console (SEO reporting), a project-management tool (Linear/Asana/Jira) for the roadmap below.
- **Cowork artifacts**: a live "Migration QA Dashboard" and "Pre-Launch Checklist tracker" as persisted artifacts the team can re-open and refresh — happy to build these once you confirm a data-access path (API or read replica).
- **Scheduled tasks**: e.g., a weekly automated Lighthouse/SEO report, or a daily "new orders / low stock" digest once connectors are wired up.

---

## 5. Git Workflow — `main` / `develop` Branching Strategy

### 5.1 Strategy: Simplified Git Flow (suited to a small team + Railway auto-deploy)

- **`main`** — always production-ready. Protected. Deploys automatically to **production** Railway services.
- **`develop`** — integration branch. Deploys automatically to a **staging/preview** Railway environment. All feature work merges here first.
- **`feature/*`**, **`fix/*`**, **`chore/*`** — short-lived branches off `develop`, merged via PR.
- **`hotfix/*`** — branched off `main` for urgent production fixes, merged back into both `main` and `develop`.

```
main        ●───────●───────────●   (production deploys)
             \       \           \
develop       ●───●───●───●───●───●   (staging deploys)
                \   \       \
feature/ui-pdp   ●───●        \
fix/audio-cat         ●────────●
```

### 5.2 One-time setup commands (run by whoever has admin on the GitHub repo)

```bash
# 1. Ensure local main is up to date
git checkout main
git pull origin main

# 2. Create develop branch from current main
git checkout -b develop
git push -u origin develop

# 3. (On GitHub) Set branch protection rules:
#    - main: require PR review + passing CI checks, no direct pushes, no force-push
#    - develop: require passing CI checks, allow PR merges from feature branches

# 4. (On GitHub) Set "develop" as the default branch for new PRs (Settings → Branches)
```

### 5.3 Day-to-day commands (for you / your developer / Claude Code)

**Starting new work:**
```bash
git checkout develop
git pull origin develop
git checkout -b feature/premium-pdp-redesign
# ... make changes ...
git add .
git commit -m "feat(pdp): redesign product detail page with editorial layout"
git push -u origin feature/premium-pdp-redesign
# Open PR: feature/premium-pdp-redesign -> develop
```

**Bug fixes (non-urgent):**
```bash
git checkout develop
git pull origin develop
git checkout -b fix/audio-category-mapping
# ... make changes ...
git commit -m "fix(products): correct audio category mapping for 72 products"
git push -u origin fix/audio-category-mapping
# Open PR: fix/audio-category-mapping -> develop
```

**Releasing develop → main (production release):**
```bash
git checkout main
git pull origin main
git merge --no-ff develop -m "release: v0.2.0 - premium PDP + product data QA"
git push origin main
git tag -a v0.2.0 -m "Premium PDP redesign + product migration QA"
git push origin v0.2.0
```

**Urgent production hotfix:**
```bash
git checkout main
git pull origin main
git checkout -b hotfix/checkout-payment-error
# ... fix ...
git commit -m "fix(checkout): resolve Razorpay webhook signature mismatch"
git push -u origin hotfix/checkout-payment-error
# PR -> main (merge), then ALSO:
git checkout develop
git pull origin develop
git merge --no-ff hotfix/checkout-payment-error -m "chore: merge hotfix back into develop"
git push origin develop
```

**Keeping a feature branch up to date (avoid messy merge conflicts):**
```bash
git checkout feature/premium-pdp-redesign
git fetch origin
git rebase origin/develop
# resolve conflicts if any, then:
git push --force-with-lease
```

### 5.4 Commit message convention (recommended: Conventional Commits)
The existing git log already mostly follows this — keep it consistent:
- `feat(scope): ...` — new feature
- `fix(scope): ...` — bug fix
- `refactor(scope): ...` — code change, no behavior change
- `chore(scope): ...` — tooling/config/deps
- `test(scope): ...` — tests only
- `docs(scope): ...` — documentation

---

## 6. CI/CD Recommendations

You already have `ci-frontend.yml`, `ci-tests.yml`, `ci.yml`, `deploy.yml`. Recommended adjustments to align with the new branch strategy:

1. **Trigger CI on all branches** (already configured for frontend — `branches: ["**"]`) — good, keep this so feature branches get fast feedback.
2. **Gate `develop` merges**: require lint + unit tests + build to pass (already wired via `needs: [lint, test]`).
3. **Add a staging deploy job** triggered only on push to `develop` → deploys to a separate Railway environment/service (e.g., `autobacs-staging-frontend`, `autobacs-staging-backend`) with its own MongoDB database (or a read-only snapshot) — **never point staging at the production database** when testing destructive migration scripts.
4. **Production deploy job** triggered only on push to `main` (or on tag creation `v*`) → deploys to the existing production Railway services.
5. **Add a visual regression / Lighthouse CI step** to the frontend pipeline once the UI revamp begins — catches premium-UI regressions automatically (e.g., `treosh/lighthouse-ci-action`).
6. **Add the environment validation script** (`validate-production-env.js`) as a required step before any production deploy job runs.
7. **Add a database index check** (`ensure-production-indexes.js`) as a post-deploy step (idempotent, safe to re-run).

Example addition to `deploy.yml` (conceptual, for the developer to adapt):
```yaml
on:
  push:
    branches: ["main", "develop"]

jobs:
  deploy-staging:
    if: github.ref == 'refs/heads/develop'
    # ... deploy to staging Railway service ...

  deploy-production:
    if: github.ref == 'refs/heads/main'
    needs: [lint, test, build]
    # ... validate env, deploy to production Railway service, run index migration ...
```

---

## 7. Prioritized Action Plan (next 30 days)

| Week | Workstream A (Data/Backend) | Workstream B (UI/Design) | Workstream C (Process) |
|---|---|---|---|
| 1 | Rotate secrets; run migration QA reconciliation script; fix 37 mis-categorized products | Design system + moodboard sign-off | Create `develop` branch, set branch protections, brief developer/Claude Code on this doc |
| 2 | Resolve Audio=0 anomaly, SKU collision check, image coverage audit | Homepage + PLP redesign on `feature/*` branches into `develop` | Set up staging Railway environment + CI staging deploy |
| 3 | Variant/attribute model decision + backfill; re-verify guest checkout e2e | PDP redesign, "Complete the Build" cross-sell surfaced | Lighthouse CI added to pipeline |
| 4 | Search/facets on frontend (Elasticsearch), recommendations surfaced | Vehicle/model pages redesign; accessibility pass | First `develop → main` release; analytics (GA4/Search Console) wired |

---

## 8. Open Questions for You

1. Do you have WooCommerce REST API credentials (or WP admin access) so the migration QA script can pull live data programmatically?
2. Do you have read access to the MongoDB Atlas cluster (or can the developer provide a sanitized export) for the same reconciliation?
3. Is there an existing brand guideline (logo usage, exact color codes, fonts) beyond what's in `globals.css`, or should the design system be built from scratch based on the current dark theme?
4. Target launch date — this affects how aggressively Phase 2 (UI revamp) and Phase 3 (feature parity) can run in parallel vs. sequentially.
5. Do you want a Figma file produced, or should the design system be defined directly in code (Tailwind config + Storybook) for faster developer handoff?

---

*This document is a planning artifact. No code was executed or modified as part of producing it.*
