# Autobacs India — Roadmap: Repo → Full-Fledged Premium E-Commerce Site

A phase-by-phase execution plan. Work top to bottom; phases 2-4 can run in parallel once Phase 0/1 are clear. Each phase has a **Goal**, **Tasks**, **Deliverable**, and **Exit Criteria** (= "done" definition, do not move on until met).

---

## PHASE 0 — Repo & Environment Setup
**Goal:** Safe, working foundation for everything else.

Tasks:
- [ ] Create `develop` branch from `main`; push to GitHub.
- [ ] Set GitHub branch protection: `main` requires PR + passing CI, no direct push/force-push; `develop` requires passing CI.
- [ ] Confirm `.env` files are NOT in working tree or git history going forward (already gitignored — verify clone is clean).
- [ ] Rotate ALL secrets exposed in old git history: MongoDB password, Google Maps keys, SendGrid key, Cloudinary secret, JWT secret, Google/Facebook OAuth secrets, Razorpay keys.
- [ ] Update Railway env vars with rotated secrets (both backend + frontend services).
- [ ] Create a **staging environment** on Railway: separate frontend + backend services + separate MongoDB DB (or read replica), deploying from `develop`.
- [ ] Run `node scripts/validate-production-env.js` against staging — must pass with 0 errors.
- [ ] Run `node scripts/ensure-production-indexes.js` against staging DB.

**Deliverable:** Working `develop` branch deployed to staging Railway URL, separate from production.
**Exit criteria:** Staging site loads, env validation passes, secrets rotated and confirmed working (login, DB connection, image upload all functional on staging).

---

## PHASE 1 — Product Data QA (900 products)
**Goal:** Every product accurate, complete, and correctly categorized — this is the foundation of the storefront.

Tasks:
- [ ] Get WooCommerce REST API credentials (WP Admin → WooCommerce → Settings → Advanced → REST API).
- [ ] Get MongoDB Atlas read access (or request a sanitized JSON/CSV export of the `products` collection).
- [ ] Build/run a reconciliation script: WooCommerce products vs MongoDB products, matched by SKU → fallback slug match.
- [ ] Output diff report: missing products, price mismatches, missing/broken images, extra/unmapped products.
- [ ] Fix the 37 known mis-categorized products (brand name sitting in category field — see `reports-mapping/validation-summary-with-mapping.txt`).
- [ ] Investigate and fix the "Audio: 0 products" category anomaly.
- [ ] Run SKU uniqueness check across all ~900 products; fix any collisions from the auto-generated SKU algorithm.
- [ ] Verify image coverage: every product has ≥1 Cloudinary-hosted image (no leftover `autobacsindia.com/wp-content/uploads/...` URLs).
- [ ] Spot-check 5 products per category (40 total) for description quality — strip leftover WooCommerce shortcodes/HTML artifacts.
- [ ] Confirm stock status + sale pricing ("was/now" pricing) migrated correctly and renders on PDP.
- [ ] Confirm variant/attribute data (size, color, vehicle fitment) — decide schema if not already supported, backfill.
- [ ] Every product mapped to ≥1 of the 8 categories AND, where applicable, a vehicle model.

**Deliverable:** `PRODUCT_MIGRATION_QA_REPORT.md` + reconciliation CSV + fixed data in staging DB.
**Exit criteria:** 0 mis-categorized products, 0 SKU collisions, 100% image coverage, diff report reviewed and signed off by you.

---

## PHASE 2 — Design System (Premium / Zara-tier)
**Goal:** A defined, reusable visual language before any page rebuild starts.

Tasks:
- [ ] Build moodboard (Zara, Porsche Design, Rivian, Aritzia, COS) — annotate specific patterns: grid density, image cropping, type pairing.
- [ ] Define color tokens (map onto existing CSS vars: void/carbon/graphite/steel/blue/gold/chrome) — confirm gold is reserved for premium/sale signals only.
- [ ] Define type scale (12/14/16/20/28/40/64px), confirm DM Sans (body) + Barlow Condensed (display/category) usage rules.
- [ ] Define spacing/grid scale (4/8px grid), card sizing, image aspect ratios (standardize via Cloudinary `f_auto,q_auto`).
- [ ] Define motion guidelines (Framer Motion): easing curves, scroll-reveal rules, hover/zoom behavior.
- [ ] Build core component library: buttons, product card, badges, filters/facets, modals, accordions, mega-menu — in Figma or directly in Tailwind/Storybook (your call, see open question).
- [ ] Write a "Do Not" list: no countdown timers, no "X people viewing" banners, no dense coupon bars, minimal badge clutter.

**Deliverable:** Design system file (Figma or Storybook) + written style guide doc.
**Exit criteria:** You sign off on the design system before any page rebuild begins.

---

## PHASE 3 — UI/UX Rebuild (page by page, on `develop`)
**Goal:** Rebuild the storefront to premium standard, page by page, each behind its own feature branch → PR → `develop`.

Tasks (in priority order):
- [ ] **Homepage**: full-bleed hero (image/video of styled vehicle), single primary CTA, curated featured-brands carousel, visual "Shop by Vehicle" model selector.
- [ ] **Product Listing (PLP)**: larger cards (3-4/row desktop), hover-to-second-image, sticky filters with vehicle-compatibility as top filter, clean price display.
- [ ] **Product Detail (PDP)**: image gallery dominant (60-70% viewport), sticky buy box, fitment/compatibility table, accordion specs/shipping/warranty, "Complete the Build" cross-sell using existing complementary-products feature.
- [ ] **Cart & Checkout**: streamlined steps, sticky order summary, trust badges near payment, re-verify guest checkout end-to-end (history of fragility here — add Playwright e2e coverage).
- [ ] **Vehicle/Model pages** (`/model/[slug]`, `/vehicles`, `/super-cars`): hero per vehicle, curated category sets, "build your [Hilux/Thar]" framing.
- [ ] **Secondary pages**: brands, categories, wishlist, compare, orders/track, profile — apply design system consistently.
- [ ] Visual regression tests (Playwright snapshots) added per rebuilt page.
- [ ] Accessibility pass: run `jest-axe` / `@axe-core/react` (already installed), fix violations per page.

**Deliverable:** Fully rebuilt frontend on `develop`, deployed to staging, matching design system.
**Exit criteria:** All pages above rebuilt, visually reviewed by you on staging, Lighthouse Accessibility ≥ 90 on each.

---

## PHASE 4 — Feature Parity (Myntra/Flipkart-level commerce features)
**Goal:** Close functional gaps vs. major e-commerce platforms. Run in parallel with Phase 3 where backend-only.

Tasks — verify/complete each:
- [ ] Search: Elasticsearch is backend-ready — confirm frontend search-as-you-type, typo tolerance, faceted search (vehicle/brand/price/category) is live.
- [ ] Recommendations: confirm "frequently bought together," "you may also like," "recently viewed" (Dexie already installed for local storage) are implemented and visible.
- [ ] Promotions/coupons engine — build if missing.
- [ ] Multi-address book per user + saved Razorpay payment methods (tokenization).
- [ ] Transactional emails via SendGrid: order confirmation, shipping update, abandoned cart, back-in-stock — confirm all flows exist and fire correctly.
- [ ] Shipping integration: Shiprocket or Delhivery for label generation/tracking.
- [ ] PWA: confirm `@ducanh2912/next-pwa` is configured, site installable, offline browsing of cached pages works.
- [ ] Reviews/Q&A, wishlist, compare, returns/refunds — confirm existing admin-side features are fully wired to frontend.
- [ ] Analytics: GA4 + Google Search Console wired up, sitemap submitted.

**Deliverable:** Feature gap checklist with each item marked "exists/verified", "built new", or "deferred" + reasoning.
**Exit criteria:** All "high priority" items (search, recommendations, transactional emails, coupons) complete and tested on staging.

---

## PHASE 5 — Performance, SEO & Monitoring
**Goal:** Production-grade speed, discoverability, and observability.

Tasks:
- [ ] Lighthouse audit on homepage, PLP, PDP, checkout — target 90+ Performance/SEO/Accessibility.
- [ ] Image pipeline: confirm Sharp/WebP conversion runs automatically, not ad hoc.
- [ ] JSON-LD structured data: Product, BreadcrumbList, Organization schemas on relevant pages.
- [ ] Core Web Vitals monitoring (Sentry performance or Railway/Vercel analytics).
- [ ] Continue Server Component conversion for client-heavy pages.
- [ ] Add Lighthouse CI step to frontend pipeline (catches regressions automatically going forward).

**Deliverable:** Performance/SEO audit report with before/after Lighthouse scores.
**Exit criteria:** All key pages ≥ 90 Performance/SEO/Accessibility on Lighthouse, structured data validates in Google Rich Results Test.

---

## PHASE 6 — Launch Readiness & CI/CD
**Goal:** Safe, repeatable deploys; go-live.

Tasks:
- [ ] Finalize CI/CD: `develop` → staging auto-deploy, `main` → production auto-deploy (only after PR approval + passing CI).
- [ ] Add `validate-production-env.js` as a required pre-deploy step for production.
- [ ] Add `ensure-production-indexes.js` as a post-deploy step.
- [ ] Switch Razorpay to LIVE keys (only on production, after a successful real test transaction).
- [ ] Complete `PRE_LAUNCH_CHECKLIST.md` in full (secrets, payments, security headers, caching, monitoring, load test, SEO, analytics).
- [ ] Run load test (`npm run load-test:quick` / `:full`) — target P95 < 2s, no 5xx under load.
- [ ] Document rollback procedure (Railway rollback + DB backup restore).
- [ ] Merge `develop` → `main`, tag release (e.g. `v1.0.0`), deploy to production.
- [ ] Post-launch: monitor error rates/payments intensively for 7 days (Sentry, Railway logs, Razorpay dashboard).

**Deliverable:** Live production site at the premium-redesigned standard, with QA'd product catalog.
**Exit criteria:** Pre-launch checklist 100% complete, production deploy verified (health check, test purchase, monitoring active).

---

## Quick Reference: Branching Commands

```bash
# One-time
git checkout main && git pull origin main
git checkout -b develop && git push -u origin develop

# New work
git checkout develop && git pull origin develop
git checkout -b feature/<name>
# ...work... commit... push...
# PR: feature/<name> -> develop

# Release to production
git checkout main && git pull origin main
git merge --no-ff develop -m "release: vX.Y.Z"
git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z

# Hotfix
git checkout main && git pull origin main
git checkout -b hotfix/<name>
# ...fix... PR -> main, then merge main back into develop
```

---

## Open Items Needed From You
1. WooCommerce REST API credentials (for Phase 1 reconciliation).
2. MongoDB Atlas read access or a data export (for Phase 1).
3. Design system format preference: Figma vs. directly in Tailwind/Storybook (Phase 2).
4. Target launch date (affects how much of Phase 3/4 runs in parallel).
