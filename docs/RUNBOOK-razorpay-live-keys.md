# Runbook — Razorpay: separate test vs live credentials

**Goal:** production Railway takes real payments with `rzp_live_*` keys and a strong,
random webhook secret. The `test` Railway environment stays on `rzp_test_*` with its own
secret. Nothing is shared between them.

**Change type:** env-only, two dashboards (Railway + Vercel) plus Razorpay. No code edits —
`razorpayService.js` reads `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` straight from env and
makes no test-vs-live assumptions.

---

## Starting state (audited 2026-07-10)

| | production | test |
|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_test_…` (**same pair as test**) | `rzp_test_…` |
| `RAZORPAY_WEBHOOK_SECRET` | 5 lowercase words joined by `_` — human-chosen, weak | 43-char random |
| Registered webhook pointing at it | **none** | none (add in step 2) |

Two facts that drive everything below:

1. **Razorpay issues exactly one Test-mode key pair per account.** While both environments
   are in test mode their keys *cannot* differ. Real separation only exists once production
   moves to live keys.
2. **Test mode and Live mode have separate webhook lists** in the Razorpay dashboard. A
   webhook registered in Test mode never fires for live payments, and vice versa.

Because no webhook currently points at the Railway backend, its `RAZORPAY_WEBHOOK_SECRET`
is orphaned — rotating it breaks nothing.

---

## Prerequisites

- Razorpay account is **activated for Live mode** (KYC complete). Without activation,
  live keys do not exist and this runbook cannot proceed.
- You can reach the Razorpay, Railway, and Vercel dashboards.

**Live secrets must never be pasted into a chat, a ticket, or a commit.** Generate them
locally and type them straight into the dashboard that needs them.

---

## Step 1 — Generate a fresh webhook secret (local, private)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Keep this on your clipboard. It goes in exactly two places, and nowhere else:
the Razorpay Live-mode webhook, and Railway's `production` environment.

This value is *chosen by you*, not issued by Razorpay. Razorpay HMAC-SHA256s each webhook
body with it and sends the digest as `x-razorpay-signature`; the backend recomputes and
compares in constant time (`middleware/razorpayWebhook.js`).

## Step 2 — Razorpay dashboard: live keys + live webhook

1. Switch the dashboard to **Live mode** (top toggle).
2. *Account & Settings → API Keys → Generate Live Key.* The **key secret is shown once** —
   copy it now.
3. *Account & Settings → Webhooks → Add New Webhook* (still in Live mode):
   - **URL:** `https://ecommerceautobacs-production.up.railway.app/api/v1/razorpay/webhook`
   - **Secret:** the value from step 1
   - **Events:** `payment.captured`, `payment.failed`, `order.paid` — only these three.
     The handler whitelists exactly this set and returns 200 for anything else.

> At domain cutover this URL becomes `https://api.autobacsindia.com/api/v1/razorpay/webhook`.
> Editing the webhook URL then does **not** require changing the secret.

## Step 3 — Railway `production` environment

Set three variables (Railway dashboard → project `bountiful-surprise` → environment
**production** → service `EcommerceAutobacs` → Variables):

| Variable | Value |
|---|---|
| `RAZORPAY_KEY_ID` | `rzp_live_…` from step 2 |
| `RAZORPAY_KEY_SECRET` | live key secret from step 2 |
| `RAZORPAY_WEBHOOK_SECRET` | the random value from step 1 |

Confirm you are on the **production** environment, not `test`. Redeploy the service.

Leave the `test` environment untouched — it keeps its `rzp_test_*` keys and its own
webhook secret. That is the separation.

## Step 4 — Vercel frontend (do not skip)

`NEXT_PUBLIC_RAZORPAY_KEY_ID` is read by `src/hooks/useRazorpay.ts` when opening the
checkout modal. If the backend mints a **live** `order_id` while the browser opens checkout
with a **test** key, Razorpay rejects the mismatch and every checkout fails.

Vercel → project → Settings → Environment Variables → **Production**:

```
NEXT_PUBLIC_RAZORPAY_KEY_ID = rzp_live_…   (key id only — never the key secret)
```

`NEXT_PUBLIC_*` is inlined at **build** time, so this needs a **redeploy**, not just a
restart. Steps 3 and 4 should land close together; between them, checkout is broken.

Doing this *before* the domain cutover is deliberate: `autobacsindia.com` still serves
WooCommerce, so the Railway/Vercel stack has no real customers to break.

## Step 5 — Verify

```bash
# 1. Backend is up
curl -s https://ecommerceautobacs-production.up.railway.app/health

# 2. Live credentials actually authenticate (read-only; creates nothing)
railway ssh --service EcommerceAutobacs   # ensure: railway environment production
#   then inside:
#   node -e "const a=Buffer.from(process.env.RAZORPAY_KEY_ID+':'+process.env.RAZORPAY_KEY_SECRET).toString('base64'); \
#     fetch('https://api.razorpay.com/v1/payments?count=1',{headers:{Authorization:'Basic '+a}}) \
#       .then(r=>console.log('razorpay auth HTTP',r.status))"

# 3. Webhook rejects an unsigned request (must be 400)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://ecommerceautobacs-production.up.railway.app/api/v1/razorpay/webhook \
  -H 'Content-Type: application/json' -d '{}'
```

Then place one small real payment (₹1) end-to-end and confirm in the Razorpay dashboard
that the webhook delivery shows **200**. Refund it afterwards.

Expect a real invoice email to the paying customer: production has no `EMAIL_REDIRECT_TO`,
by design. Never set that variable in production.

---

## Rotating the webhook secret later

You pick the value; it must match on both sides, and Razorpay supports only one secret per
webhook at a time. So there is a brief window where in-flight webhooks fail signature
verification and return 400. Razorpay retries failed deliveries with backoff for roughly a
day, so events that land mid-rotation are redelivered.

1. Generate a new value (step 1).
2. Update the Razorpay webhook's secret **first**.
3. Update `RAZORPAY_WEBHOOK_SECRET` in Railway and redeploy.
4. Confirm delivery status is 200 on the next event.

Keep the gap short. Never reuse a secret across test and live.

---

## Gotchas

- **One test key pair per account.** `production` and `test` share `rzp_test_*` until
  production goes live. This is a Razorpay constraint, not a misconfiguration.
- **Test-mode webhooks fan out.** Every registered Test-mode webhook receives every
  test payment — including the legacy WooCommerce endpoint
  (`https://www.autobacsindia.com/payment/razorpay/webhook`). Do **not** register the
  production backend in Test mode: test payments would write orders into the production
  database.
- **Two webhook handlers exist.** The live one is `middleware/razorpayWebhook.js`, mounted
  at `app.js` *before* `express.json()` because signature verification needs the raw body.
  The one at `routes/razorpay.js` is shadowed by that earlier mount and never runs. Editing
  it will look correct and do nothing.
- **Key secret is never public.** Only `RAZORPAY_KEY_ID` belongs in `NEXT_PUBLIC_*`.
- **Live keys are shown once.** If lost, regenerate — and remember that regenerating
  invalidates the old pair.
