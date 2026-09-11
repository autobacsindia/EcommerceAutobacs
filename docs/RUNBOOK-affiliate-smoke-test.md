# RUNBOOK — Affiliate programme, full manual smoke test

Hand-driven verification of the **entire** affiliate programme: application, review,
approval, attribution, commission arithmetic, the buyer's experience, the affiliate's
dashboard, maturity, payouts, TDS, suspension, and the security boundaries around all of
it.

**Time:** ~2 h for the full pass · ~20 min for [Phase 2 (Critical)](#phase-2--critical-the-case-that-used-to-break) alone.

**Run on TEST.** Phase 2 is safe to repeat on prod with a throwaway account and a real
card. Everything else — especially Phases 7–9 — stays on test.

> **Automated alternative.** `npm run affiliate-smoke-test -- --confirm-api=railway`
> (in `Back-end/server`) drives Phases 0, 2–9 and 11 over the API in a couple of minutes.
> It cannot see a single pixel, so **Phases 1, 3, 10 and 12 are manual regardless**. This
> document is the complete manual pass and stands alone — use it when you want to verify
> what a human actually experiences, or when the script reports a failure you need to
> reproduce by hand.

---

## Contents

| Phase | What | Time | P0? |
|---|---|---|---|
| [0](#phase-0--preconditions) | Preconditions — do not skip | 5 min | ✅ |
| [1](#phase-1--public-discovery--the-application-form) | Public discovery + the application form | 20 min | |
| [2](#phase-2--critical-the-case-that-used-to-break) | **CRITICAL** — the returning buyer | 20 min | ✅ |
| [3](#phase-3--the-affiliates-dashboard--discoverability) | The dashboard + discoverability | 15 min | |
| [4](#phase-4--attribution-link-code-cookie-precedence) | Attribution: link, code, cookie, precedence | 15 min | ✅ |
| [5](#phase-5--commission-arithmetic) | Commission arithmetic | 10 min | ✅ |
| [6](#phase-6--negative-cases-these-must-all-fail-loudly) | Negative cases | 15 min | ✅ |
| [7](#phase-7--money-integrity) | Money integrity | 20 min | ✅ |
| [8](#phase-8--maturity) | Maturity | 10 min | |
| [9](#phase-9--payouts--tds) | Payouts + TDS | 20 min | |
| [10](#phase-10--suspension-reinstatement-terms-editing) | Suspension, reinstatement, terms editing | 10 min | |
| [11](#phase-11--security-boundaries) | Security boundaries | 15 min | ✅ |
| [12](#phase-12--legibility-responsive-seo) | Legibility, responsive, SEO | 10 min | |
| [—](#reset-between-runs) | Reset between runs | 5 min | |

---

## Phase 0 — Preconditions

A failure here makes every later phase look broken for the wrong reason.

| # | Check | How | Must be |
|---|---|---|---|
| 0.1 | Commission kill switch | `railway variables --kv --environment test \| grep AFFILIATE_COMMISSION_ENABLED` | `=true`, spelled **COMMI-SS-ION** |
| 0.2 | Switch is *live*, not just set | `railway deployment list` vs `/health` uptime | container started **after** the var was last edited |
| 0.3 | Repeat-rate default | `… \| grep AFFILIATE_DEFAULT_REPEAT_COMMISSION_PERCENT` | a number (default `2`) |
| 0.4 | Indexes exist | `npm run audit-index-drift` | `couponuserusages`, `affiliatecommissions`, `affiliatepayouts` in **no** drift bucket |
| 0.5 | Code is deployed | `/health` uptime resets after your merge | fresh container |
| 0.6 | Payout minimum | `… \| grep AFFILIATE_MIN_PAYOUT_RUPEES` | note the value — default **₹1,000** |

> ### 0.2 is the one that bites
> Railway injects env vars only at container start. A corrected variable sitting in the
> dashboard does nothing until `railway redeploy`. Compute it: the `uptime` seconds from
> `/health` must place container start *after* your last variable edit.

> ### 0.6 decides whether Phase 9 is reachable
> Commission at 10% of a ₹1,000 order is **₹90**. The payout batch builder refuses
> anything under `MIN_PAYOUT_RUPEES` (**₹1,000** by default), so with the ₹1,000 fixture
> below you will never accumulate enough to build one. Before Phase 9, pick one:
>
> - **(a)** set `AFFILIATE_MIN_PAYOUT_RUPEES=1` on test and redeploy *(easiest)*; or
> - **(b)** use a product around **₹12,000** for Phase 9's orders, so one order clears it.
>
> Decide now. Discovering it at step 9.3 costs a rebuild of the whole fixture.

**URLs**

| | Test | Prod |
|---|---|---|
| Storefront | `https://ecommerce-autobacs-git-develop-autobacsindia.vercel.app` | `https://autobacsindia.com` |
| API | `https://ecommerceautobacs-test.up.railway.app` | `https://api.autobacsindia.com` |
| Mongo | `TEST_MONGODB_URI` | `MONGODB_URI` |

**Payment:** test env uses `rzp_test_*`. Card `4111 1111 1111 1111`, any future expiry,
any CVV, any OTP.

**Reference values** (from `config/affiliate.js` / `config/returnPolicy.js`):

| Constant | Value |
|---|---|
| Attribution window (`ab_ref` cookie) | **30 days** |
| Return window (drives maturity) | **4 days** after delivery |
| Default commission / repeat / discount | 5% / 2% / 5% |
| Minimum payout | ₹1,000 |
| Stale-pending alert threshold | 60 days |
| Code format | `^[A-Z0-9][A-Z0-9_-]{2,23}$` |
| TDS section (declared, unverified) | 194H, threshold ₹20,000/yr |

---

## Phase 1 — Public discovery + the application form

### 1a. Can a stranger find the programme?

- [ ] **1.1** Storefront footer → **Company** column → ✅ **Affiliate Programme** → `/affiliates`.
- [ ] **1.2** `/affiliates` loads with hero, three "how it works" cards, and the form.
- [ ] **1.3** ✅ The copy names **no commission rate**. Rates are per-affiliate and set at
      approval — a number printed here is a promise nobody made.
- [ ] **1.4** `/affiliates/terms` opens, shows a **version** and a **last updated** date.
- [ ] **1.5** View source → ✅ `<title>` and canonical are present (it is a real indexed page).

### 1b. Field validation — each must be refused

Submit with everything else valid, one bad field at a time.

- [ ] **1.6 PAN** `ABCDE123` → ✅ refused, *"Enter a valid 10-character PAN"*.
- [ ] **1.7 IFSC** `HDFC1234567` (5th char not `0`) → ✅ refused.
- [ ] **1.8 Account number** `12345` (under 6 digits) → ✅ refused, *"6–20 digits"*.
- [ ] **1.9 Phone** `1234567890` (does not start 6–9) → ✅ refused.
- [ ] **1.10 PIN code** `068200` (leading zero) → ✅ refused.
- [ ] **1.11 GSTIN** `29ABCDE1234F1Z` (14 chars) → ✅ refused. Then **clear it** → ✅ accepted
      (it is optional; blank must not fail the pattern).
- [ ] **1.12 Terms unticked** → ✅ the submit button is **disabled**.
- [ ] **1.13 State** is a `<select>`, not free text — place of supply is decided by it.
      ✅ **"Andhra Pradesh" appears exactly once** *(GST codes 28 and 37 both map to it;
      a duplicate here means the de-dupe regressed)*.

### 1c. A successful application

- [ ] **1.14** Apply as a **non-customer identity** — an email/phone that has never ordered.
      Use `aff-main@…`.
- [ ] **1.15** ✅ "Application received" confirmation.
- [ ] **1.16** ✅ **Duplicate guard:** apply again with the same email → refused.

**Verify the PII was encrypted, not stored in the clear:**

```js
db.affiliates.findOne({ email: 'aff-main@…' },
  { email:1, status:1, 'payoutDetails.accountLast4':1, 'payoutDetails.ifsc':1,
    'payoutDetails.accountNumber':1, 'payoutDetails.panNumber':1, termsAcceptance:1 })
```

- [ ] **1.17** ✅ `status: 'pending'` — an application grants **nothing**.
- [ ] **1.18** ✅ `accountNumber` and `panNumber` are **unreadable ciphertext**, not digits.
- [ ] **1.19** ✅ `accountLast4` is the real last 4 (derived on write).
- [ ] **1.20** ✅ `termsAcceptance.version` matches the version shown at 1.4, and `ipHash`
      is a hash — never a raw IP.
- [ ] **1.21** ✅ A **pending** affiliate has **no `code`** and **no `coupon`**.

---

## Phase 2 — CRITICAL: the case that used to break

> This is the regression the whole design exists for. Before the fix, step 2.11 returned a
> **hard 400** and no order was created, while the same buyer arriving by link earned the
> affiliate the **full** commission. **If you only have 20 minutes, run this phase.**

### 2a. Fixture — approve with exact rates

Use these rates so the arithmetic below is clean.

- [ ] **2.1** Admin → `/admin/affiliates` → open the pending application.
- [ ] **2.2** Approve with **Commission 10%**, **Repeat commission 3%**, **Buyer discount 10%**,
      code `SMOKE10`.
- [ ] **2.3** ✅ Status flips to `active`, code shown.

```js
db.coupons.findOne({ code: 'SMOKE10' },
  { code:1, value:1, visibility:1, isActive:1, firstOrderOnly:1, usageLimitPerUser:1, affiliate:1 })
```

- [ ] **2.4** ✅ `usageLimitPerUser: 1` ← the one-discount-per-person rule
- [ ] **2.5** ✅ `firstOrderOnly: false` ← **must NOT be true**; true means old code or an
      unmigrated coupon
- [ ] **2.6** ✅ `visibility: 'hidden'` (never listed publicly), `isActive: true`,
      `value: 10`, `affiliate` points at the affiliate
- [ ] **2.7** ✅ Approval email states **both** rates — "10% … new to Autobacs India" AND
      "3% … bought from us before". If it names only one, the copy branch is wrong.

### 2b. First order — acquisition

Use a **fresh customer account** (`smoke1@…`) that has never ordered.

- [ ] **2.8** Add a **₹1,000** product to cart.
- [ ] **2.9** Apply `SMOKE10` on `/cart`. ✅ Discount **₹100**; toast says "SMOKE10 applied" (green).
- [ ] **2.10** Complete payment.

```js
db.orders.findOne({ /* this order */ }, { subtotal:1, discount:1, totalAmount:1, affiliate:1 })
```

✅ `discount: 100`, and:

| Field | Expected |
|---|---|
| `affiliate.source` | `"coupon"` |
| `affiliate.commissionPercent` | `10` ← full rate |
| `affiliate.newCustomer` | `true` |
| `affiliate.code` | `"SMOKE10"` |

### 2c. Second order — SAME account, SAME code

- [ ] **2.11** Add the same ₹1,000 product. Apply `SMOKE10` again.
- [ ] **2.12** ✅ **No red error.** Expect a neutral grey note: *"You have already used this
      coupon — no discount on this order, but SMOKE10 still credits whoever referred you."*
- [ ] **2.13** ✅ The code **stays in the cart** (is not stripped).
- [ ] **2.14** ✅ Toast is neutral, **not** green "applied".
- [ ] **2.15** Go to checkout. ✅ Coupon block is **grey/neutral**, not red, and shows **no**
      "Edit coupon in cart →" link.
- [ ] **2.16** ✅ **Payment completes.** ← *The headline assertion. This previously 400'd.*

| Field | Expected |
|---|---|
| `discount` | `0` |
| `totalAmount` | **higher** than order 1 |
| `affiliate.source` | `"code"` ← new value, not `coupon`, not `link` |
| `affiliate.commissionPercent` | `3` ← repeat rate |
| `affiliate.newCustomer` | `false` |

### 2d. Commission ledger

```js
db.affiliatecommissions.find({ type: 'accrual' },
  { order:1, amountPaise:1, basePaise:1, percent:1, source:1, status:1 }).sort({ createdAt: 1 })
```

- [ ] **2.17** ✅ Exactly **two** accrual rows.

| Order | basePaise | percent | amountPaise | source |
|---|---|---|---|---|
| 1 | `90000` (₹900 = 1000 − 100) | `10` | `9000` (₹90) | `coupon` |
| 2 | `100000` (₹1,000, no discount) | `3` | `3000` (₹30) | `code` |

- [ ] **2.18** ✅ Both `status: "pending"` (matures 4 days after delivery — not payable yet).
- [ ] **2.19** ✅ Order 2 has the **larger base**. Counterintuitive but correct: commission
      is a share of revenue, and no discount means more revenue.

> ❌ **Zero rows?** `AFFILIATE_COMMISSION_ENABLED` is not live in the running container.
> Back to precondition 0.2 — this is the most common false failure.

---

## Phase 3 — The affiliate's dashboard + discoverability

### 3a. Can they find it?

The dashboard once shipped with **nothing** linking to it — the only door was the
approval email.

- [ ] **3.1** Sign in as a **non-affiliate**. `/profile` → ✅ an "Affiliate Programme" card
      with **Learn more →** to `/affiliates`. **No** dashboard link.
- [ ] **3.2** Sign in as `SMOKE10`'s owner. `/profile` → ✅ "Affiliate Dashboard" card showing
      the code, linking to `/account/affiliate`. Click → it opens.
- [ ] **3.3** Mobile width → hamburger → ✅ an **Affiliate Dashboard** row below Wishlist.
      ✅ **Absent** for a non-affiliate.
- [ ] **3.4** Visit `/affiliates` while signed in as the approved affiliate → ✅ "You are
      already an affiliate" + **Open your dashboard**. **Not** a blank application form
      asking again for the PAN and bank details they already gave us.
- [ ] **3.5** ✅ **No flash.** Reload `/affiliates` hard (Cmd-Shift-R) and watch carefully:
      the apply form must **never** appear for a split second before swapping away.
      *(It discards anything typed, and the form asks for a PAN.)*
- [ ] **3.6** ✅ Same on `/account/affiliate`: a hard reload must **never** flash
      "You're not an affiliate yet" before the real dashboard.

### 3b. The four states

- [ ] **3.7 Not an affiliate** → "You're not an affiliate yet" + link to `/affiliates`.
- [ ] **3.8 Pending** → "Application under review", **no** ledger, **no** code.
- [ ] **3.9 Active** → full dashboard.
- [ ] **3.10 Suspended** *(set it in Phase 10, then come back)* → "Your account is paused"
      + contact support. ✅ `/profile` and the nav **still** link here — past earnings are
      still theirs to see.
- [ ] **3.11 Network failure** → DevTools → Network → **Offline** → reload.
      ✅ "We couldn't load your dashboard" with a **Retry**.
      ❌ It must **not** say "You're not an affiliate yet" — that tells someone their
      membership vanished because a request timed out.

### 3c. Content

- [ ] **3.12** ✅ Link is `<storefront-origin>/?ref=SMOKE10`. **Copy** button copies it.
- [ ] **3.13** ✅ Text states the attribution window as **30 days**.
- [ ] **3.14** ✅ Both rates stated when they differ: "10% … new to Autobacs India, and 3%
      when they have bought from us before."
- [ ] **3.15** Set repeat **equal** to commission → ✅ copy says "every order you bring in,
      new or returning" and does **not** scope it to new customers.
- [ ] **3.16** Set repeat to **0** → ✅ "**nothing** when they have bought from us before".
- [ ] **3.17** ✅ Earnings tiles: **Ready to pay**, Pending, Approved, Paid — each with an
      order count.
- [ ] **3.18** ✅ Ledger lists both orders: date, order value, commission, status badge.
- [ ] **3.19** ✅ Pending rows show "Confirms `<date>`" (delivery + 4 days).
- [ ] **3.20** With >25 rows, **Older** paginates and **Back to start** returns.
      ✅ No row is repeated or skipped across the boundary.

---

## Phase 4 — Attribution: link, code, cookie, precedence

### 4a. The referral link

- [ ] **4.1** Fresh account `smoke2@…`. Visit `…/?ref=SMOKE10`.
- [ ] **4.2** ✅ DevTools → Application → Cookies → `ab_ref = SMOKE10`, **HttpOnly**,
      **Secure**, **SameSite=Lax**, expiry ≈ **30 days** out.
- [ ] **4.3** ✅ The URL redirected clean — no `?ref=` left in the address bar.
- [ ] **4.4** Visit `…/products/<slug>?ref=SMOKE10&color=red` → ✅ cookie set, `?ref=`
      stripped, **`color=red` preserved**, and you land on the product page (not home).
- [ ] **4.5** ✅ Deep links work: the cookie is set on **any** page, not just the homepage.

### 4b. Arrival routes must agree

- [ ] **4.6** With `smoke2@…`, place and pay a **first** order, accepting the suggested code.
      ✅ `source: "coupon"`, `commissionPercent: 10`, `newCustomer: true`.
- [ ] **4.7** Place a **second** order applying **no code at all** (cookie only).
      ✅ Order succeeds, `source: "link"`, `commissionPercent: 3`, `newCustomer: false`.
- [ ] **4.8** ✅ Compare with 2.16: **same 3% rate** whether they arrived by code or link.
      A mismatch here is the original bug returning.

### 4c. The lapsed customer

Proves the rule is *one per person per code*, not *never bought here*.

- [ ] **4.9** Fresh account `smoke3@…`. Place and pay an order with **no** affiliate code.
      ✅ No `affiliate` block on that order at all.
- [ ] **4.10** Place a second order, now applying `SMOKE10` (first time **she** has used it).
- [ ] **4.11** ✅ She **GETS the ₹100 discount** — `discount: 100`, `source: "coupon"`.
- [ ] **4.12** ✅ But the affiliate earns `commissionPercent: 3`, `newCustomer: false`.
      Reactivation, not acquisition.

### 4d. Precedence — a typed code beats a stale cookie

- [ ] **4.13** Approve a second affiliate `SMOKE20` (any rates).
- [ ] **4.14** Fresh account. Visit `…/?ref=SMOKE20` to plant that cookie.
- [ ] **4.15** At checkout, type **`SMOKE10`** instead. Pay.
- [ ] **4.16** ✅ `affiliate.code === "SMOKE10"` — the affiliate the buyer *named* wins.
      If `SMOKE20` is credited, you are paying the wrong person.

### 4e. Last click wins

- [ ] **4.17** Visit `…/?ref=SMOKE10`, then `…/?ref=SMOKE20`.
      ✅ `ab_ref` is now `SMOKE20` — overwritten unconditionally.
- [ ] **4.18** Visit `…/?ref=not-a-code!!` → ✅ the **existing** cookie is untouched and no
      junk cookie is written *(the regex rejects it)*.

---

## Phase 5 — Commission arithmetic

Verify against the ledger rows from Phase 2.

- [ ] **5.1** ✅ `basePaise` = **goods net of discount**, in paise —
      `(subtotal − discount) × 100`.
- [ ] **5.2** ✅ Shipping is **excluded** from the base. Place an order that incurs shipping
      and confirm `basePaise` ignores it.
- [ ] **5.3** ✅ Tax is **excluded** from the base.
- [ ] **5.4** ✅ `amountPaise = Math.floor(basePaise × percent / 100)` — always **floors**.
      Test it: a base that divides unevenly (e.g. ₹333.33 at 3%) must round **down**.
- [ ] **5.5** ✅ Commission appears **nowhere** in the customer's numbers — not in
      `Order.discount`, not on the invoice, not in any refund figure. It is our cost, in a
      separate ledger.
- [ ] **5.6** ✅ The rate on the row is the **snapshot** from the order, not a live read of
      the affiliate document.

---

## Phase 6 — Negative cases (these must all FAIL loudly)

The soft refusal from Phase 2 must stay narrow.

- [ ] **6.1 Typo.** Apply `SMOKE1O` (letter O). ✅ **Red error, 400, code NOT remembered.**
      Reload `/cart` → coupon field empty.
      *A silently-swallowed typo means checking out believing in a discount you never got.*
- [ ] **6.2 Unknown code.** Apply `NOSUCHCODE`. ✅ "Invalid coupon code", 400.
- [ ] **6.3 Suspended affiliate.** Admin → suspend `SMOKE10`. New account applies it.
      ✅ Refused with "no longer active". Place an order anyway → ✅ **no** `affiliate` block,
      **no** discount. Reinstate afterwards.
- [ ] **6.4 Self-referral — by account.** Sign in as the affiliate's own account, apply
      `SMOKE10`. ✅ "can't be used on your own account". Order without it → ✅ no attribution.
- [ ] **6.5 Self-referral — by email.** Different account, but checkout email matches the
      affiliate's. ✅ Still refused.
- [ ] **6.6 Self-referral — by phone.** Different account and email, but the same 10-digit
      phone. ✅ Still refused.
- [ ] **6.7 Pending affiliate's code.** Take a **pending** application, guess a code → ✅ it
      does not exist and cannot attribute. An application grants nothing.
- [ ] **6.8 Ordinary reused coupon.** Create a normal coupon with `usageLimitPerUser: 1`
      and **no affiliate**. Use it twice. ✅ Second attempt **hard-fails** — the exemption
      is for affiliate codes only.
- [ ] **6.9 Expired cookie.** In DevTools, edit `ab_ref`'s expiry to the past, reload, place
      an order. ✅ No attribution.

---

## Phase 7 — Money integrity

- [ ] **7.1 One discount, ever.** With `smoke1@…`, try `SMOKE10` a **third** time.
      ✅ Still no discount, still credits the affiliate.
```js
db.couponuserusages.findOne({ /* coupon: SMOKE10._id, user: smoke1 */ })  // count MUST be 1
```

- [ ] **7.2 Webhook replay — same event.** Razorpay dashboard → Webhooks → resend
      `payment.captured` for order 1.
      ✅ `db.affiliatecommissions.countDocuments({ order: <id>, type:'accrual' })` is still **1**.

- [ ] **7.3 Webhook replay — NEW event id, same payment.** *(The one that actually matters.)*
      7.2 is stopped at the door by Redis event-id dedup. This one slips past that layer
      and must be stopped by the real guarantee — the unique `{order, type:'accrual'}` index.
      Easiest path: `npm run affiliate-smoke-test -- --confirm-api=railway --only=money`,
      or replay from Razorpay twice >24 h apart (the dedup key's TTL).
      ✅ Still exactly **1** accrual row.

- [ ] **7.4 Double-click Pay.** On a fresh order, click Pay twice rapidly.
      ✅ **One** order, **one** charge, **one** accrual, **one** confirmation email.

- [ ] **7.5 Snapshot holds.** Admin → change `SMOKE10` to Commission 25% / Repeat 15%.
      ✅ Orders 1 and 2 still read `10` and `3`, and their `amountPaise` is unchanged.
      Past orders are never repriced.

- [ ] **7.6 New order uses new rates.** Place another order → ✅ picks up 25/15.

- [ ] **7.7 Clawback — full refund.** Admin → refund order 2 in full.
      ✅ A `clawback` row **appears** (the accrual is **not** rewritten);
      `Σ amountPaise` for that order nets to **0**.

- [ ] **7.8 Clawback — partial return.** Return **one line** of a multi-line order.
      ✅ A clawback proportional to what came back; the affiliate keeps commission on what
      the customer kept.

- [ ] **7.9 Clawback after payout.** Refund an order whose commission was already `paid`.
      ✅ The `paid` row is **untouched** (it records money that left the bank); a **negative**
      `approved` row appears and carries against the next batch.
      ✅ The dashboard shows the amber "carried against your next earnings" note, and says
      nothing is owed by them directly.

- [ ] **7.10 Abandoned checkout does not brand you.** Fresh account: start checkout,
      **dismiss** the Razorpay popup (leaves `paymentStatus: 'pending'`). Now place a real
      first order with `SMOKE10`.
      ✅ `newCustomer: true` and the **full** rate. An unpaid order is not a purchase.
      *This was a real bug: the abandoned row marked them a returning customer forever.*

- [ ] **7.11 Cancelled order.** Cancel a paid, attributed order.
      ✅ Clawback row; ledger nets to 0.

---

## Phase 8 — Maturity

Commission matures only after **delivery + 4 days**. Nobody waits four days, and the sweep
is a 4 a.m. cron with no button, so use the harness:

```bash
cd Back-end/server
npm run affiliate-test-drive -- --status --code=SMOKE10
npm run affiliate-test-drive -- --mature=<orderId> --confirm-cluster=autobacstest
```

- [ ] **8.1** Before: ✅ row is `pending`, `maturesAt` is `null` **until the order is delivered**.
- [ ] **8.2** Mark the order **delivered** in admin → ✅ `maturesAt` is stamped to
      **delivery + 4 days**.
- [ ] **8.3** ✅ The dashboard row now reads "Confirms `<that date>`".
- [ ] **8.4** Run `--mature=<orderId>` → ✅ status flips `pending` → `approved`.
- [ ] **8.5** ✅ The dashboard tile moves the money from **Pending** to **Ready to pay**.
- [ ] **8.6 An undelivered order never matures.** A paid-but-never-delivered order
      ✅ stays `pending` with `maturesAt: null` forever.
- [ ] **8.7 An in-flight return freezes maturity.** Open a return on a delivered order,
      then run the sweep → ✅ the row is **skipped**, not approved.
- [ ] **8.8 Stale-pending alert.** `/admin/affiliates` ✅ banner warns about commissions paid
      but never marked delivered (threshold 60 days).
- [ ] **8.9 Re-running the sweep is safe.** Run `--mature` twice → ✅ no duplicate rows, no
      double approval.

---

## Phase 9 — Payouts + TDS

> ⚠️ Re-read **precondition 0.6** first. With the ₹1,000 fixture you have ~₹120 of
> commission and the batch builder will refuse below ₹1,000.

- [ ] **9.1** Admin → `/admin/affiliates/<id>` → ✅ Earnings shows **Ready to pay** matching
      the affiliate's own dashboard figure, to the paisa.
- [ ] **9.2 Below the minimum.** With less than `MIN_PAYOUT_RUPEES` approved →
      ✅ **Build payout batch** is disabled or 400s with a clear message.
- [ ] **9.3** Set `TDS %` to **5** on the affiliate. Build the batch.
- [ ] **9.4** ✅ Redirects to `/admin/affiliates/payouts` with a new row.

```js
db.affiliatepayouts.findOne({ /* newest */ })
```

- [ ] **9.5** ✅ `grossPaise` = Σ of the claimed rows.
- [ ] **9.6** ✅ `tdsPercent: 5` — **snapshotted**, so a later rate change cannot rewrite it.
- [ ] **9.7** ✅ `tdsPaise = floor(gross × 5 / 100)`.
- [ ] **9.8** ✅ `netPaise = grossPaise − tdsPaise`.
- [ ] **9.9** ✅ `commissionCount` > 0; `periodFrom`/`periodTo` span the claimed rows.
- [ ] **9.10** ✅ `bankSnapshot` holds **only** `accountLast4` / `ifsc` / `upiId` —
      **no** full account number, **no** PAN.
- [ ] **9.11** ✅ The claimed commission rows flipped to `status: 'paid'` with `payout` set.
- [ ] **9.12 Double-build guard.** Click **Build payout batch** again immediately.
      ✅ **409** — the claim lives in the rows, so no second payout with money can exist.
- [ ] **9.13 Negative balance.** Trigger 7.9 (refund after payout), then try to build.
      ✅ Refused with "owes ₹X back from refunded orders"; the debt carries forward.
- [ ] **9.14 Record paid.** Enter a UTR → ✅ status `paid`, `paidAt` and `paidBy` set.
- [ ] **9.15 Duplicate UTR.** Build a second batch, paste the **same** UTR.
      ✅ Refused — "already recorded against another payout".
- [ ] **9.16 Mark failed.** On a draft batch → ✅ rows **released** back to `approved` with
      `payout: null`, and they can be re-batched.
- [ ] **9.17 Payout email.** ✅ The affiliate receives it with **gross, TDS and net** broken
      out — not just a net figure.
- [ ] **9.18 TDS CSV.** `/admin/affiliates/payouts` → **TDS CSV**.
      ✅ Columns: PAN, Name, Gross, TDS %, TDS, Net, Paid on, Reference.
      ✅ Opens in Excel; the rows sum to the batch gross.
      ✅ **Formula injection is neutralised** — set an affiliate name to `=1+1`, re-export,
      and confirm the cell is **not** evaluated by Excel.
      ✅ Response carries `Cache-Control: no-store`.

---

## Phase 10 — Suspension, reinstatement, terms editing

- [ ] **10.1 Suspend.** ✅ Managed coupon flips `isActive: false` in the **same** operation.
- [ ] **10.2** ✅ Already-earned commissions keep their lifecycle — **no** reversal rows
      appear. The work was done. Voiding is a separate, deliberate action.
- [ ] **10.3** ✅ The affiliate's dashboard says "paused" but still lists earnings.
- [ ] **10.4 Reinstate.** ✅ Both the affiliate **and** the coupon reactivate together.
- [ ] **10.5 Reinstating a never-approved applicant** → ✅ refused.
- [ ] **10.6 Reject a pending application.** ✅ Terminal, and the **PAN and bank details are
      purged** from the document — verify in Mongo.
- [ ] **10.7** ✅ Re-applying after rejection creates a **new** record, not a revival.

### Terms editing

- [ ] **10.8** ✅ Two rate fields exist: "Commission % (new customer)" and "Commission % (repeat)".
- [ ] **10.9** ✅ **No** "Only pay on a customer's first order" checkbox anywhere. That
      control was removed; its label never matched what it did.
- [ ] **10.10 Blank means "don't touch".** Clear the repeat field, change **only TDS %**, Save.
      ✅ `repeatCommissionPercent` is **unchanged** in Mongo — not `0`, not the default.
- [ ] **10.11 Deliberate zero survives.** Set repeat to `0`, Save, reload.
      ✅ Still `0` (not silently replaced by the default).
- [ ] **10.12 Buyer discount mirrors to the coupon.** Change discount to 15% →
      ✅ `db.coupons.findOne({code:'SMOKE10'}).value === 15`.
- [ ] **10.13 Discount dropped to 0** → ✅ the coupon is **deactivated** (nobody should
      "apply" a code worth nothing).
- [ ] **10.14 Out-of-range** — commission `101`, or `-1` → ✅ refused.

---

## Phase 11 — Security boundaries

### 11a. The `/me` projection

- [ ] **11.1** Admin → add internal **Notes** to `SMOKE10`, e.g. "haggled on rate".
- [ ] **11.2** As that affiliate: DevTools → Network → `GET /affiliates/me` → **Response**.
      ✅ **No** `notes`, **no** `suspendedReason`, **no** `termsAcceptance.ipHash`,
      **no** `pitch`, **no** `payoutDetails.accountNumber`, **no** `panNumber`.
      ✅ `code`, `status`, `commissionPercent`, `payoutDetails.accountLast4` **are** present.
      *The response is a whitelist (`affiliateService.toSelfView`) — a field added to the
      model stays invisible here until someone names it.*
- [ ] **11.3** Suspend them, re-check → ✅ still **no** `suspendedReason` in the body.

### 11b. Scoping and IDOR

- [ ] **11.4** As affiliate A, `GET /api/v1/affiliates/me/commissions` → ✅ only A's rows.
- [ ] **11.5** ✅ There is **no** query parameter that can name another affiliate — the id
      comes from the session.
- [ ] **11.6** As a plain customer: `GET /affiliates/me` → ✅ **200** with `affiliate: null`
      (not a 404 — being a non-affiliate is normal).
- [ ] **11.7** Same customer: `GET /affiliates/me/commissions` → ✅ **403**.
- [ ] **11.8** Signed out entirely: `GET /affiliates/me` → ✅ **401**, never 200.

### 11c. Admin lockout

- [ ] **11.9** As a customer, hit each of these → ✅ **401/403**, never 200, never a partial body:
      `/affiliates/admin`, `/affiliates/admin/<id>`, `/affiliates/admin/payouts`,
      `/affiliates/admin/payouts/tds-export`, `/affiliates/admin/<id>/approve`.
- [ ] **11.10** Browser → `/admin/affiliates` as a customer → ✅ redirected to `/`.
- [ ] **11.11** ✅ `/admin/affiliates/<id>` never shows the full account number or PAN —
      only `accountLast4` and IFSC come back after saving.

### 11d. Rate limits and pagination

- [ ] **11.12** Submit the application form ~10× rapidly → ✅ rate-limited (429), not
      accepted as free storage.
- [ ] **11.13** `GET /affiliates/me/commissions?limit=100000` → ✅ refused or clamped to ≤100.
- [ ] **11.14** ✅ Every list uses a **cursor** (`before=`/`nextCursor`), never `page=`/`skip=`.

### 11e. Indexing rules

- [ ] **11.15** `/robots.txt` → ✅ `/account` is **disallowed**.
- [ ] **11.16** `/sitemap.xml` → ✅ contains `/affiliates` and `/affiliates/terms`,
      and **does not** contain `/account/affiliate`.
- [ ] **11.17** View source on `/account/affiliate` → ✅ `<meta name="robots" content="noindex">`.

---

## Phase 12 — Legibility, responsive, SEO

The storefront body is `#080808`. These pages previously used the admin light palette.

> ⚠️ **Verify on a real build.** Injecting classes into a deployed page via DevTools
> silently no-ops for any utility not already in the shipped CSS bundle, and
> `npm run dev` renders some routes unstyled. Build the frontend yourself, or check the
> deployed test environment — not a devtools experiment.

- [ ] **12.1** `/account/affiliate` as a **non-affiliate** → ✅ "You're not an affiliate yet"
      is readable. *(Was dark grey on near-black, with no card behind it.)*
- [ ] **12.2** Same page as a **pending** applicant → ✅ "Application under review" readable.
- [ ] **12.3** Same page as **suspended** → ✅ readable.
- [ ] **12.4** `/affiliates` → ✅ every field **label** and hint readable, including the
      PAN / bank block. *(Inputs were rescued by global `input {}` rules; labels were not.)*
- [ ] **12.5** `/affiliates/terms` → ✅ body prose readable.
- [ ] **12.6** ✅ Status badges on the ledger are legible tints, not near-white chips.
- [ ] **12.7** ✅ The ledger table scrolls **inside its own container** at 375 px wide —
      the page body must not scroll horizontally.
- [ ] **12.8** ✅ The referral-link input and Copy button do not overflow at 375 px.
- [ ] **12.9** Keyboard only: ✅ Tab reaches Copy, Older, Back to start; focus is visible.
- [ ] **12.10** ✅ Colour is not the only signal — each status badge has a text label.

---

## Reset between runs

The per-person cap means you **cannot** simply retry with the same account.

```js
// Make a test account "new" again
db.couponuserusages.deleteMany({ user: <userId> })
db.orders.deleteMany({ user: <userId> })                 // TEST DATA ONLY
db.affiliatecommissions.deleteMany({ user: <userId> })

// Remove the whole fixture
db.affiliatepayouts.deleteMany({ affiliate: { $in: [<ids>] } })
db.affiliatecommissions.deleteMany({ affiliate: { $in: [<ids>] } })
db.affiliates.deleteMany({ code: { $in: ['SMOKE10','SMOKE20'] } })
db.coupons.deleteMany({ code: { $in: ['SMOKE10','SMOKE20'] } })
```

> ⚠️ **Never run these against prod.** Confirm your shell is on `TEST_MONGODB_URI` first.
> Remember `hasActiveOrder` keys on `paymentStatus` — an account is "new" only when it has
> no `paid` **or** `refunded` order.
>
> If you set `AFFILIATE_MIN_PAYOUT_RUPEES=1` for Phase 9, **put it back**.
>
> The automated script namespaces every record it creates and cleans up after itself —
> `npm run affiliate-smoke-test -- --confirm-api=railway --keep` skips teardown if you
> want to inspect the wreckage.

---

## Fast triage

| Symptom | Almost always |
|---|---|
| No commission rows at all | `AFFILIATE_COMMISSION_ENABLED` not in the **running** container (0.2) |
| Second order 400s | Old code deployed — the soft refusal is missing |
| Repeat order pays full rate | `repeatCommissionPercent` unset → intentional full-rate fallback |
| Red error instead of grey note | Frontend not deployed, or `couponErrorCode` not reaching the UI |
| Returning customer reads as new | Their prior order never reached `paymentStatus: paid` |
| New customer reads as returning | They have an old `paid`/`refunded` order |
| Discount applied twice | Unique `{coupon,user}` index missing — **stop and fix** (0.4) |
| Commission never matures | Order never marked delivered, or an in-flight return is freezing it (8.6/8.7) |
| Payout batch refuses | Below `MIN_PAYOUT_RUPEES` (0.6), or a negative balance from a post-payout refund (9.13) |
| Second batch build 409s | Correct — the first one already claimed the rows |
| Dashboard flashes the wrong state | A loading gate regressed to `isLoading` instead of `isPending` (3.5/3.6) |
| Dashboard unreadable | Admin light palette leaked back onto the dark theme (Phase 12) |
| `/affiliates` shows the form to an affiliate | The already-an-affiliate branch or its loading gate regressed (3.4) |

---

## Sign-off

- [ ] Phase 0 (preconditions) clean
- [ ] Phase 2 (**Critical**) fully passed
- [ ] Phases 4–7 (attribution, arithmetic, negatives, money) passed
- [ ] Phases 8–9 (maturity, payouts, TDS) passed
- [ ] Phase 11 (security) passed
- [ ] Phases 1, 3, 10, 12 (UI, lifecycle, legibility) passed
- [ ] Fixture cleaned up; `AFFILIATE_MIN_PAYOUT_RUPEES` restored
- [ ] Tested on: `test` / `prod` — date: ................ tester: ................
- [ ] Anything skipped, and why: ..................................................
