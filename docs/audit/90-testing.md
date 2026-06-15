# 90 — Testing & QA

_Phase 1. Backend: Jest + supertest + mongodb-memory-server. Frontend: Jest + Testing Library + jest-axe + Playwright (e2e)._

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| Q1 | P1 | `ci.yml` runs only a **curated subset**: `--testPathPatterns="orderStatusService\|uploadMiddleware\|auth.integration\|productImageController\|e2e.product-lifecycle"` | CI does **not** run the full backend suite — most of the 30 test files don't gate merges | Run full suite in CI (or document why subset); keep coverage floor meaningful |
| Q2 | P1 | Coverage floor `jest.config.js` = lines/funcs/statements **55%**, branches **45%**; `ci.yml` comment claims 60% | Coverage threshold low + doc mismatch; money/auth paths need higher | Reconcile to one number; raise floor on `controllers/orderController`, `services/order*`, auth |
| Q3 | P1 | Prior memory: `guest-checkout.spec.ts` written but **never executed** (Playwright not installed) | Guest checkout (revenue path) has untested e2e | `npx playwright install chromium` + run in CI against a preview/backend URL |
| Q4 | P2 | COD has no UI selector though models accept `paymentMethod:'cod'` (prior memory) | COD path only testable at API layer — UI gap untested | Add COD UI + e2e once UI revamp lands |
| Q5 | P2 | BE 30 test files vs 26 models + 11 controllers + 37 services; root one-off `test-*.js` are scripts, not Jest specs | Real unit/integration coverage is thin relative to surface | Add tests on payments, orders, cart, inventory, auth |
| Q6 | P3 | FE: 3 test locations (`src/tests`, `src/integration-tests`, `src/app/integration-tests`) + `tests/e2e` | Fragmented test layout | Consolidate |

## What's tested vs. what matters
- **Tested (gated):** order status service, upload middleware, auth integration, product image controller, a product-lifecycle e2e. FE: 75 test files incl. a11y.
- **Under-tested (high-value):** payment capture/refund (Razorpay), cart→order conversion, inventory/warehouse, guest checkout e2e (written, unrun), COD.
- **Risk areas touching money/auth/migration with weak coverage:** `controllers/orderController.js` (881 LOC), `services/orderNotificationService.js`, the WP import services (data-migration correctness).

## CI gating
- `ci.yml` (backend) + `ci-frontend.yml` (lint→test→build) run on all branches incl. `develop`. Build is gated on lint+test (FE). Backend coverage floor enforced by Jest exit code — but only over the curated subset (Q1).

## Fixtures / seed
- Extensive seed scripts (`seed-*.js`) but used operationally, not as test fixtures. `mongodb-memory-server` available for isolated integration tests.
