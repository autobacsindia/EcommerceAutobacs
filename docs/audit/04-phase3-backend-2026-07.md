# Phase 3 — Backend / API Correctness (2026-07)

_Auditor: Claude Code · Date: 2026-07-09 · Read-only, findings only._

**Verdict: backend correctness is in good shape.** June's biggest concern (unbounded queries) is largely resolved; error handling is secure-by-default; cache invalidation is wired and production-safe. Findings are **P3 (resilience/observability hygiene)** — no P0/P1/P2.

## Verified strengths (evidence)

| Area | Evidence | Status |
|---|---|---|
| Pagination on public paths | `returnController` (`.limit`+skip), `leadController` (`Math.min(MAX_LIMIT,…)`), `productService`/`searchService` (`.limit()` + `.maxTimeMS(2000)`) | ✅ June B1 largely closed |
| No error/PII leakage | `errorMiddleware.js`: "never expose stack traces"; client payload = `{message(allowlisted), errorId, code, safeErrors}` only; stacks truncated for **logging** only; Sentry fingerprinting | ✅ secure-by-default |
| Cache invalidation wired | `invalidateCache(...)` on product bulk/image/sale + category writes; main update `updateProductWithImages` → `invalidateCache('products')` + trailing ES-sync middleware | ✅ |
| Non-blocking invalidation | `CacheService.invalidatePattern` uses **SCAN MATCH** (not blocking `KEYS`), cursor loop, `COUNT 100` | ✅ prod-safe |
| WP-import target | base URL is `WORDPRESS_SITE_URL` **env**, not user input; only paths/IDs appended | ✅ not an SSRF vector |
| Invoice idempotency | `invoiceService.js:201` skip if `order.invoiceEmailedAt`; set at `:234` | ✅ (see BE-2 caveat) |

## Findings

| ID | Sev | File | Issue | Fix |
|----|-----|------|-------|-----|
| BE-1 | P3 | `middleware/elasticsearchSyncMiddleware.js`, `middleware/cacheMiddleware.js:107` | ES sync **and** cache invalidation are **fire-and-forget with only `console` on failure**. A failed ES index → silent Mongo↔ES drift; a failed invalidation → stale cache. No metric/alert/retry; backstop is a manual `reindex-products`. | Emit a failure **metric + alert** (Sentry/counter) on both; add a periodic **reconcile** (ES↔Mongo diff) job. Keep fire-and-forget for latency, but make failures observable. |
| BE-2 | P3 | `services/invoiceService.js:201-234` | Idempotency is **read-then-write** on `invoiceEmailedAt` (check at 201, set at 234) — not atomic. If BullMQ delivers the same job twice concurrently, both can pass the check → **double invoice email**. | Atomic claim: `Order.findOneAndUpdate({_id, invoiceEmailedAt: null}, {$set:{invoiceEmailedAt: now}})` and only send if it matched. Same pattern for status/review emails. |
| BE-3 | P3 | `controllers/adaptiveThrottlingController.js` | Lone `.find()` with no `.limit()`. Admin-only, small collection → low risk. | Add a bounded limit for consistency. |
| BE-4 | P3 | `controllers/returnController.js:136-141` | User-supplied `limit` passed as `.limit(Number(limit))` with **no max cap** (contrast `leadController`'s `Math.min(MAX_LIMIT,…)`). User-scoped so bounded by own returns → low. | Cap with a shared `MAX_LIMIT`. |

## Notes
- **ES sync fire-and-forget is a deliberate latency tradeoff** and reasonable; the finding is purely the *lack of observability* on failure, not the pattern.
- Cache invalidation is also fire-and-forget (`cacheMiddleware.js:107`, "intentionally do NOT await") — correct for response latency; failure is `.catch`-logged (folds into BE-1).

## Deferred / not verified here
- Full N+1 sweep on populate-heavy admin list endpoints (orders/leads with nested populates) — targeted profiling, not static read; revisit if perf surfaces in testing.
- Blog/journal endpoints pagination + `/api/revalidate/home` cache-poisoning hardening (memory noted a poisoned Data Cache entry) → **Phase 5 (frontend)** owns Next.js Data Cache.

## Exit criteria
- [x] Unbounded-query DoS surface re-scanned (essentially closed).
- [x] Error/PII leakage verified absent.
- [x] Cache invalidation wiring + SCAN safety verified.
- [x] WP SSRF + invoice idempotency resolved.
- [ ] BE-1..4 (P3) → fix backlog.
