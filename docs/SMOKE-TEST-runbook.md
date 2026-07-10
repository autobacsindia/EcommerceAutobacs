# Manual Smoke Test Runbook — Live (Vercel + Railway), Razorpay TEST

**Target:** the live pre-cutover stack — frontend on **Vercel**, backend on **Railway**, Razorpay in **TEST** mode. The real customer site is still WooCommerce; this stack is not yet serving real buyers.

**Goal:** exercise the three personas end-to-end — **Customer**, **Admin**, **Sales Rep** (a sales rep is an admin with `isSalesRep=true` for now) — catch regressions and edge cases, then **remove every test artifact** from the single shared prod DB.

> Owner mindset: you are testing against the same MongoDB that will become production. Treat every write as if a customer could see it. Follow the naming convention below religiously — it is the only thing that makes clean deletion possible.

---

## 0. The database question (read this first)

You have **one** MongoDB. Three ways to run this test, worst → best:

| Option | What it is | Cleanup | When |
|---|---|---|---|
| ❌ Test on prod, no plan | Ad-hoc accounts/orders | Impossible to find later | Never |
| ✅ **Test on prod + convention + cleanup script** | Every test doc uses a reserved namespace (`smoke+…@`, `[SMOKE]…`, `SMOKE10`) | `scripts/cleanup-smoke-test-data.js` deletes by convention | **Do this now** — it's what this runbook is built for |
| ⭐ **Clone to a throwaway staging DB** | `mongodump` prod → `mongorestore` into a fresh DB; point a staging backend + Vercel preview at it | Delete the whole clone | Best if you'll test repeatedly, or once real customers exist |

**"If I create a new DB, how will all the data A–Z be there?"**
It's a full byte-for-byte copy — nothing is missing:

```bash
# 1. Dump the current (prod) DB — every collection, every doc, indexes
mongodump --uri="$PROD_MONGODB_URI" --out=./dump-$(date +%F)

# 2. Restore into a brand-new DB name (or a fresh Atlas M0 free cluster)
mongorestore --uri="$STAGING_MONGODB_URI" --nsFrom='prod.*' --nsTo='staging.*' ./dump-$(date +%F)
```

The clone has all products, categories, users, orders, media refs — **A to Z** — because `mongodump` copies the entire database. You then set the staging backend's `MONGO_URI` to the clone and test freely; when done you drop the clone and the real DB is untouched. Cloudinary/Elasticsearch/Redis are shared and mostly harmless (search reindex + a Redis flush at the end covers it).

**Recommendation:** since there are no real buyers yet, do **Option ✅ (test on prod + convention + cleanup)** for this pass — fastest, and the cleanup is surgical. But **take a `mongodump` snapshot first** (below) so you always have a nuclear rollback.

### 0.1 Mandatory pre-test backup (your safety net)

```bash
mongodump --uri="$PROD_MONGODB_URI" --out=./backup-pre-smoke-$(date +%F-%H%M)
```

Two independent cleanup paths after testing:
- **Surgical (default):** run the cleanup script — removes only convention-tagged docs, keeps any real activity.
- **Nuclear rollback:** `mongorestore --drop` the snapshot — reverts everything, **but wipes anything real written during the window.** Only use if you're certain no real writes happened concurrently.

---

## 1. Pre-flight checks (5 min, do not skip)

Confirm you're pointed at the right things and nothing charges real money.

- [ ] **Frontend URL** (Vercel) loads: `https://autobacsindia.com` **or** the current `*.vercel.app` preview.
- [ ] **Backend health**: `GET https://<railway-host>/api/v1/health` (or the frontend proxy `GET /api/health`) returns `200`.
- [ ] **Razorpay is TEST**: Vercel `NEXT_PUBLIC_RAZORPAY_KEY_ID` starts with `rzp_test_`; Railway `RAZORPAY_KEY_ID` is the matching **test** key. **If you see `rzp_live_`, STOP.**
- [ ] **Webhook** points at the Railway backend `…/api/v1/razorpay/webhook` and `RAZORPAY_WEBHOOK_SECRET` is set (payment-success side effects — invoice email, karma earn — depend on it).
- [ ] **CORS**: Railway `FRONTEND_URL`/`FRONTEND_URLS` includes the exact Vercel origin you're testing from.
- [ ] **Email**: Postmark is in TEST/single-sender mode (per project notes) — invoice/review emails will only reach the verified sender inbox. Use that inbox for the customer account so you can actually receive them.
- [ ] **Backup taken** (§0.1).

---

## 2. Reserved test-data convention (the cleanup contract)

**Everything you create MUST match one of these**, or the cleanup script won't find it:

| Thing | Convention | Example |
|---|---|---|
| User emails | `smoke+<role>-<n>@autobacsindia.com` | `smoke+cust-01@autobacsindia.com` |
| User names (fallback) | starts with `[SMOKE]` | `[SMOKE] Test Buyer` |
| Guest checkout email | `smoke+guest-01@autobacsindia.com` | — |
| Coupon codes | starts with `SMOKE` | `SMOKE10`, `SMOKEFREESHIP` |
| Test products (if any) | name starts with `[SMOKE]` | `[SMOKE] Dummy Wax` |
| Consultation/contact/Q&A | use a `smoke+…@` email | — |

Prefer testing against **existing real products** (read-only) and only create `[SMOKE]` products when you must test product CRUD. Keep a running note of IDs you touch.

---

## 3. Accounts to prepare

1. **Customer** — register in-app at `/register` with `smoke+cust-01@autobacsindia.com`.
2. **Admin** — use your existing admin login (`role=admin`). Do **not** delete it; it's not a smoke account.
3. **Sales Rep** — register `smoke+rep-01@autobacsindia.com` as a normal customer, then have the admin promote it:
   - Admin → `/admin/users` → open the user → set **role = admin** and **isSalesRep = true**, set a `salesTarget` (e.g. 10).
   - ⚠️ **Changing role/email increments session version → the rep is force-logged-out.** Re-login as the rep afterward (expected behaviour, worth verifying — see edge cases).

---

## 4. Razorpay TEST payment instruments

Use on the Razorpay checkout modal (test mode):

- **Card success:** `4111 1111 1111 1111`, any future expiry, any CVV, any name; OTP `1234` (or the test OTP shown).
- **Card failure:** use Razorpay's documented failure test card, or click **Cancel** on the modal to simulate abandonment.
- **UPI success:** `success@razorpay`. **UPI failure:** `failure@razorpay`.
- **Netbanking:** pick any bank → choose Success/Failure on the simulator page.

No real money moves. But the **order/karma/invoice** side effects are real DB writes — hence the convention.

---

## 5. Test matrix

Legend: **[C]** customer · **[A]** admin · **[R]** sales rep. Mark ✅/❌ and note anything odd.

### 5.1 Infra / read paths
- [ ] Home `/` renders, nav + footer present, no console errors.
- [ ] `/products` list, `/products/[slug]` PDP, `/categories`, `/brands`, `/blog` all load.
- [ ] **Search** (`/products/search`) returns results (Elasticsearch-backed) and suggestions work.
- [ ] SEO: view-source on a PDP shows `<title>`, meta description, and JSON-LD; a `noindex` page is absent from `/sitemap.xml`.
- [ ] `robots.txt` disallows admin/private routes.

### 5.2 Customer journey [C]
- [ ] **Guest cart:** add-to-cart while logged out; badge count is correct (no phantom "added" toast on failure).
- [ ] **Register** `smoke+cust-01@…`; email verification flow (if enforced) works.
- [ ] **Cart merge:** log in with a non-empty guest cart → guest items merge into the user cart (union, no dupes/loss). This is the `POST /cart/merge` on login.
- [ ] **Checkout requires login** (guest magic-link is retired) — attempting checkout as guest routes to login/register.
- [ ] **Address** add/select at checkout; delivery zone/shipping resolves.
- [ ] **Coupon:** apply `SMOKE10` → discount reflected; totals recompute server-side (never trust client math).
- [ ] **Karma/loyalty:** points preview shown; balance updates only after a *paid* order (earn-on-delivery, via worker).
- [ ] **Pay (success):** Razorpay test card → redirect back → order appears in `/orders`; status is paid/confirmed.
- [ ] **Invoice email:** PDF invoice arrives (idempotent — one email even on webhook retry).
- [ ] **Order tracking** `/orders/[id]` and `/track` show correct status timeline.
- [ ] **Profile** `/profile`: edit name/address; change password.
- [ ] **Wishlist** add/remove; persists across sessions.
- [ ] **Product Q&A** and **Review** submission (review gated to a delivered purchase where enforced).
- [ ] **Returns** `/returns` / `/claim-order`: raise a return on a delivered order.

### 5.3 Admin [A]
- [ ] Login → `/admin/dashboard` loads; stats populate.
- [ ] **Products:** create `[SMOKE] Dummy Wax`, edit, set sale price + `saleEndsAt`, verify PDP countdown, then deactivate/delete.
- [ ] **Categories:** hub → subcategory drill-down; create/edit a subcategory.
- [ ] **Coupons:** create `SMOKE10` (percentage), set per-user usage limit; edit; verify limits enforced (see edge cases).
- [ ] **Orders:** open the customer's order; **walk the status transitions** → mark **Delivered**.
  - [ ] Delivered triggers the **product email + 1-day review-CTA** (delayed job; idempotent per status).
- [ ] **Refunds / Returns:** approve the return raised in §5.2 → refund path runs.
  - [ ] ⚠️ Confirm the customer's `totalSpentPaise`/`paidOrderCount` **decrement** on refund/return (net LTV). If not wired for your case, run `reconcile-user-ltv.js --apply` and file it.
- [ ] **Users:** the role/salesRep toggle (§3) works and invalidates the session.
- [ ] **SEO** `/admin/seo`: set an override on a `PageSeo` entry; confirm it wins over the computed default and that `noindex` drops it from the sitemap.
- [ ] **Media** upload → Cloudinary; image renders on the storefront.
- [ ] **Analytics** `/admin/analytics` renders without error.

### 5.4 Sales Rep [R]  (admin UI, `isSalesRep=true`)
- [ ] Rep appears in **`/admin/leads` → reps list** and the leaderboard.
- [ ] **Leads pipeline:** the smoke customer/guest shows up as a lead with the right **source** (consultancy / dormant / payment_pending / payment_failed — **cancelled is excluded**).
- [ ] **Self-claim** an unassigned lead from the pool (`POST /:id/claim`); **release** it; **bulk claim** two at once.
- [ ] **Assign** a lead to another rep (`POST /:id/assign`).
- [ ] **Status** change (`PATCH /:id/status`) + **log activity** (`POST /:id/activity`) — history persists.
- [ ] **Offline order entry:** create an order for a walk-in against `smoke+guest-…@`; dedup by email/phone works (no duplicate person).
- [ ] **Owner-at-close attribution** + net LTV reflect on conversion.

---

## 6. Edge cases & failure modes (the part that actually finds bugs)

**Payments**
- [ ] **Payment failed** (`failure@razorpay`): order stays `payment_failed`/pending, **not** confirmed; cart preserved; customer can retry.
- [ ] **User cancels** the Razorpay modal: no orphaned "paid" order; clean state.
- [ ] **Webhook idempotency:** a replayed `payment.captured` (Razorpay dashboard → resend, or duplicate) does **not** double-count karma, double-decrement stock, or send a second invoice (`WebhookEvent` / `invoiceEmailedAt` guards).
- [ ] **Signature check:** a webhook with a bad signature is rejected (401), no side effects.
- [ ] **Amount integrity:** server recomputes the amount from the cart — tampering the client total does not change what's charged.

**Coupons / karma**
- [ ] Per-user usage limit: apply `SMOKE10` beyond its cap → rejected atomically (no partial redemption row).
- [ ] Expired / inactive coupon rejected. Coupon + karma can't both be exploited in one txn (transaction guard).
- [ ] Karma spend can't exceed balance or go negative under concurrent orders.

**Inventory / concurrency**
- [ ] Two near-simultaneous checkouts on the last unit of a `[SMOKE]` product → only one succeeds; no oversell.
- [ ] Out-of-stock product blocks add-to-cart / checkout.

**Auth / sessions**
- [ ] Role/email change (§3) **logs the rep out everywhere** (session version bump) — verify old token is rejected.
- [ ] Customer cannot reach any `/admin/*` route or admin API (403), even with a valid customer token.
- [ ] A rep (admin+isSalesRep) can reach admin, but lead *assignability* is still gated by `isSalesRep` (a plain admin without the flag isn't assignable).
- [ ] Guest `x-session-id` cart doesn't leak into another guest's session.

**CRM correctness**
- [ ] A **cancelled** order does **not** create a lead (only consultancy/dormant/payment_pending/payment_failed do).
- [ ] Refund/return decrements `totalSpentPaise` (net LTV) — the known gotcha; verify or reconcile.
- [ ] Lead dedup: same email/phone via different entry points (checkout, offline, consultation) → one person, not duplicates.

**Delivery emails**
- [ ] Marking Delivered twice does not send the product/review email twice (`notifiedStatuses`/`reviewRequestedAt` idempotency). Requires the notification worker + Redis running.

**Platform**
- [ ] Rate limits: hammering login/verify returns `429`, not a 500.
- [ ] Redis outage tolerance: cache miss degrades gracefully (don't intentionally kill prod Redis — just note behaviour if it blips).
- [ ] Image domains: any legacy `wp-content` image still resolves (pre-cutover allowlist).

---

## 7. Cleanup

### 7.1 Surgical (recommended) — the cleanup script

Dry-run first (writes nothing, prints the exact plan and the emails it will delete):

```bash
cd Back-end/server
railway run node --import=dotenv/config scripts/cleanup-smoke-test-data.js
```

Review the matched users and counts. If correct, execute:

```bash
railway run node --import=dotenv/config scripts/cleanup-smoke-test-data.js --apply --yes
```

It removes convention-tagged users and cascades their orders, payments, carts, wishlists, reviews, Q&A, karma ledger, coupon redemptions/usage, returns, notification logs, leads, consultations, contacts, article comments — plus `SMOKE*` coupons and `[SMOKE]` products. It **refuses** to touch anything not matching the convention.

### 7.2 Manual leftovers the script won't handle
- [ ] Razorpay TEST dashboard: test orders/payments live there (harmless, but you can clear the test data).
- [ ] Cloudinary: delete any `[SMOKE]` media you uploaded.
- [ ] Elasticsearch: `node scripts/sync-elasticsearch.js` (or `reindex-products`) so deleted `[SMOKE]` products drop from search.
- [ ] **Redis:** flush cache so deleted data doesn't serve stale — `node scripts/flush-public-cache.js` (clears `route:*`/`public:*`).
- [ ] LTV/CRM drift: `node --import=dotenv/config scripts/reconcile-user-ltv.js --apply` to self-heal any denorm you moved.

### 7.3 Nuclear rollback (only if no real writes happened during testing)

```bash
mongorestore --drop --uri="$PROD_MONGODB_URI" ./backup-pre-smoke-<stamp>
```

Reverts the DB to the pre-test snapshot. **This also discards anything real written during the window** — hence surgical is the default.

---

## 8. Sign-off
- [ ] All §5 flows pass or issues are filed.
- [ ] Edge cases §6 reviewed; blockers triaged.
- [ ] Cleanup §7 run; dry-run of the script now reports **0 documents**.
- [ ] Redis flushed, search reindexed, LTV reconciled.
- [ ] Backup archived (keep a few days), then deleted.
