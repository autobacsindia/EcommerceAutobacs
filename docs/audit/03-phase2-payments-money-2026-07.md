# Phase 2 — Payments, Pricing & Money Integrity (2026-07)

_Auditor: Claude Code · Date: 2026-07-09 · Read-only, findings only._

**Verdict: money math and payment integrity are strong** (integer paise, server-authoritative totals, atomic coupon/karma, signature+amount-verified webhooks). **One P1 reliability bug** on the payment path and **one P2 data-integrity gap** (known) found.

## Verified strengths (evidence)

| Area | Evidence | Status |
|---|---|---|
| Integer-paise math | `pricingService.js` uses `toPaise/fromPaise` throughout; `Math.floor` on % discount (rounds in merchant favor); clamps (`Math.max(0,…)`, `Math.min`) | ✅ no float money |
| Server-authoritative totals | `orderService.js:90` "client-sent amounts are ignored entirely" → recomputes via `computeQuote`; `assertCouponApplied`; rejects total ≤ 0 | ✅ no client-total trust |
| Negative-total guard | `pricingService.js:231-237` trims karma so total ≥ 1 paise (Razorpay needs positive); correct `karmaPointsUsed -= trimmedPoints` then recompute | ✅ correct |
| Offline order path | `POST /orders/admin/offline` is `protect, admin` (`routes/orders.js:96`); trusting admin-entered amounts is acceptable | ✅ guarded |
| Coupon double-spend | `couponRepository.incrementUsageGuarded` — atomic `findOneAndUpdate` with `usedCount < usageLimit` guard; release decrements guarded (`usedCount > 0`) + `CouponRedemption` audit row for idempotent reversal | ✅ concurrency-safe |
| Karma integrity | earn/redeem/clawback all `session.withTransaction`; deduction floors at 0 (`Math.min(earn.points, balance)`); `KarmaLedger` immutable source of truth; idempotency flags (`markKarmaAwarded`, reversal lookup) | ✅ concurrency-safe |
| Webhook integrity | signature HMAC (`razorpayService.js:109`); **amount mismatch → throw** (`:394`), currency mismatch → throw; replay dedup Redis-first + Mongo unique-index E11000 fallback + 503 if both down | ✅ anti-manipulation |
| Sale countdown | `pricingService.effectivePrice()` honours expired sale window at read time (`:59`) | ✅ |

## Findings

| ID | Sev | File | Issue | Fix |
|----|-----|------|-------|-----|
| **PAY-1** | **P1** | `middleware/razorpayWebhook.js` (`finally { redisClient.quit() }`) + `services/redisClient.js:12,81` | `getRedisClient()` returns a **module-level singleton** (`new Redis()` created once). The webhook calls `redisClient.quit()` in a `finally` **on every request**. `.quit()` intentionally closes the connection; ioredis does **not** auto-reconnect after a manual quit. → The **first payment webhook after each deploy tears down the app-wide Redis** used by cache, sessions, rate-limiting, and this very replay-protection. Payment path = worst place for it. Downstream `processPaymentSuccess` idempotency limits *correctness* damage, but Redis stays dead until process restart. | **Remove the `redisClient.quit()` call entirely.** The shared client must live for process lifetime. (If a per-request client were ever intended, `getRedisClient()` would need to `.duplicate()` — but here just delete the quit.) Add a regression test asserting Redis is still connected after a webhook. |
| **PAY-2** | **P2** | `repositories/userRepository.js:78` (+ `models/User.js:156`) | `totalSpentPaise` and `paidOrderCount` are `$inc`-ed on payment but **never decremented** on refund/return/cancel (grep: only read in `leadController`). → LTV / "net spend" / sales attribution inflate over time; refunded customers look like high-value. Matches project memory (known-unwired). | Wire refund/return/cancel to subtract `totalSpentPaise` (+ decrement `paidOrderCount`), flooring at 0, inside the existing refund transaction. Add a **reconcile job** to recompute from delivered-minus-refunded orders as a backstop. Add tests for the refund→LTV path. |

## Notes / lower priority
- **Redis GET-then-SET replay dedup is not atomic** (`razorpayWebhook.js`): two concurrent identical webhooks could both pass the `GET` before either `SET`. Mitigated by downstream `processPaymentSuccess` idempotency, so no double-charge/double-fulfil. Optional hardening: use `SET key val NX EX 86400` for a true atomic claim. **P3.**
- `taxPaise` (`pricingService.js:244`) is display-only GST extraction (`Math.round`), not summed into totals — correct, no rounding leak into charge.

## Deferred / not verified here
- Invoice-email idempotency (`Order.invoiceEmailedAt`) end-to-end under retry — spot-check in Phase 3.
- Earn-on-delivery BullMQ worker presence/failure modes → Phase 6 (infra/queues).
- Razorpay **refund API** actually called vs status-only refund (offline reconciliation) — trace in Phase 3.

## Exit criteria
- [x] Pricing math, server-authoritative totals, coupon+karma atomicity verified.
- [x] Webhook signature/amount/replay verified.
- [x] Refund→LTV asymmetry confirmed (PAY-2).
- [ ] PAY-1 (P1) + PAY-2 (P2) → fix backlog.
