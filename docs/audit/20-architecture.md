# 20 — Architecture & Code Structure

_Phase 1. The structured layering (controllers/services/models/repositories) is decent; the problems are **volume, duplication, and root-directory pollution**, not absent structure._

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| A1 | P1 | `updated-category-import.js` 2400 LOC, `import-autobacs-categories.js` 2023, `routes/auth.js` 1256, `app.js` 945, `controllers/orderController.js` 881, `services/elasticsearchService.js` 928; FE `admin/products/edit/[id]/page.tsx` 1547 | God files mixing many concerns | Split routes/auth.js into auth + password + session route modules; extract import logic into a module; thin `app.js` to wiring only |
| A2 | P1 | `Back-end/server/` root holds ~hundreds of loose `check-*/import-*/cleanup-*/seed-*/debug-*/test-*` scripts + `.bat/.ps1/.log/.json` dumps | Operational/one-off scripts pollute the app root, dwarf `controllers/services/models`, obscure the real app | Move to `scripts/` (or `tools/migration/`), delete dead one-offs, keep only documented maintenance scripts |
| A3 | P2 | `middleware/securityHardening.js` **and** `securityHardeningFinal.js` **and** `securityMiddleware.js`; plus `validationMiddleware.js` + `validateRequest.js` + `validators/` + `sanitizationMiddleware.js` + `querySanitizer.js` | Overlapping/duplicated middleware with unclear ownership ("…Final" duplicate is a classic smell) | Consolidate to one security module + one validation module; delete superseded copies |
| A4 | P2 | Models `AdaptiveThrottlingProfile.js`, `RateLimitEvent.js`; `middleware/rate-limit/`, `routes/rateLimitDashboard.js`, adaptive throttling, redis monitor | Rate-limiting subsystem is heavily over-engineered for current scale (persisted throttle profiles, dashboards) | Keep `express-rate-limit` + Redis store; shelve the adaptive/dashboard layer unless scale demands it |
| A5 | P2 | Only **1** file in `validators/`; validation also in 5+ middleware files; `express-validator` also used inline | Inconsistent validation strategy spread across 3 mechanisms | Pick one (e.g. express-validator per-route) and standardize |
| A6 | P3 | `server.js`, `server.minimal.js`, `app.js`, `Dockerfile`, `Dockerfile.v2`, `nixpacks.toml` (unused) | Multiple entrypoint/build variants committed | Delete `server.minimal.js`, `Dockerfile.v2`, unused `nixpacks.toml` once confirmed dead |
| A7 | P3 | `errorMiddleware.js` + `asyncHandler.js` present and used | (Strength) Centralized error handling + async wrapper exist | Keep; ensure every async route uses `asyncHandler` |

## Module boundaries
- Backend layering exists: `routes/` (34) → `controllers/` (11) → `services/` (37) → `repositories/` (7) → `models/` (26). Reasonable for the domain.
- **Coupling risk:** WordPress/Woo import logic lives inside the prod `services/` layer (`brandProductImport`, `productImport`, `migrationOrchestration`, `categoryImport`) — see `40-backend.md` B4. Should be isolatable for removal post-migration.
- Circular dependencies: not exhaustively checked; recommend `madge --circular` in a later pass.

## Config management
- Backend reads config via `process.env` + `dotenv`; a `validate-production-env.js` gate exists (good). No central typed config object — env reads scattered.
