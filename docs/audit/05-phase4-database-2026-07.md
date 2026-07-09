# Phase 4 — Database & Data Model (2026-07)

_Auditor: Claude Code · Date: 2026-07-09 · Read-only, findings only._

**Verdict: well-modeled, durable data layer.** June's D2 (prod indexes unrun) is **resolved**. Findings are **P3 (defense-in-depth / operational)** — no P0/P1/P2.

## Verified strengths (evidence)

| Area | Evidence | Status |
|---|---|---|
| Order history durability | `models/Order.js:33-38` — items store `price`, `name`, `image` **snapshot** inline alongside `product` ref → deleting a product never corrupts historical orders | ✅ correct pattern |
| State-machine integrity | Enums on Order `status`/`paymentStatus`/`source`/return-status/refund, Lead source/status, Return status (`Order.js:98,113`; `Lead.js`) | ✅ comprehensive |
| Index coverage | 180 `.index()/unique` decls (Product 22, Lead 11, Order 10, User 9); `email` explicit unique index (`User.js:174`), `wpId` sparse-unique | ✅ strong |
| Indexes ensured in prod (D2) | `config/db.js:36` `autoIndex:true` + explicit `createIndex` safety-net at boot (`:109,219-259`, idempotent) | ✅ **D2 closed** |
| Email uniqueness in practice | `unique:true` + normalization at **every** write/lookup: `auth.js:105,193,474,725`, `magicLinkController:31`, `orderController:196,231,330`, `consultation:27`, imports | ✅ effective |
| Connection safety | No TLS fallback in prod (`db.js` comment), `retryWrites:true`, bounded pool (`maxPoolSize` 10) | ✅ |

## Findings

| ID | Sev | File | Issue | Fix |
|----|-----|------|-------|-----|
| DB-1 | P3 | `models/User.js:42` | `email` has `unique:true` but **no schema-level `lowercase:true`/`trim`**. Currently safe because every call site normalizes manually — but that's fragile: one future endpoint (or social-auth/admin-create path) that forgets `toLowerCase()` silently creates a case-variant duplicate, breaking uniqueness and cascading into lead dedup, guest-cart merge, and password reset (all email-keyed). | Add `lowercase:true, trim:true` to the `email` field as a belt-and-suspenders safety net. Backfill-normalize existing rows first (a `.toLowerCase()` migration) to avoid a unique-index build failing on existing case-dupes. |
| DB-2 | P3 | `config/db.js:36` | `autoIndex:true` is **unconditional (incl. production)**. Steady-state is fine (`createIndex` is a no-op), but adding a new index to a **large** collection then deploying triggers a **foreground index build** on boot → possible latency/lock spike. | Gate `autoIndex` to non-prod, OR keep it but adopt a rule: new indexes on large collections are built via **background migration** *before* the schema change deploys. Document in the DB runbook. |

## Deferred / not verified here
- **Cart/Wishlist orphaned refs:** these hold **live** `product` refs (no snapshot, unlike Order). Deleting a product leaves dangling refs; reads must null-guard populated `product`. Correctness lives at read time → verify in **Phase 5 (frontend/runtime)** and cart service. (Order history is unaffected — it snapshots.)
- Vehicle-fitment orphans (project memory): reported DONE; structural re-check deferred unless testing surfaces it.
- N+1 on populate-heavy admin lists → Phase 3 deferred item (profiling, not static).

## Exit criteria
- [x] Index coverage + prod-ensure (D2) verified.
- [x] Order snapshot durability + enum integrity verified.
- [x] Email uniqueness effectiveness verified (normalized at call sites).
- [ ] DB-1, DB-2 (P3) → fix backlog; cart-orphan null-guard → Phase 5.
