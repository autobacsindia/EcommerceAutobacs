hase 3
# Runbook — Go-live cutover checklist (WooCommerce → Vercel/Railway)

Plain-language, step-by-step guide to move `autobacsindia.com` from WooCommerce
(Hostinger) to the new stack: **frontend on Vercel, backend on Railway, email on
Postmark, DNS/security on Cloudflare**.

This is the operator checklist. The infra internals (Redis split, Vercel import,
Cloudflare setup) live in [RUNBOOK-cdn-redis-vercel.md](RUNBOOK-cdn-redis-vercel.md);
the full env matrix lives in [ENVIRONMENTS.md](ENVIRONMENTS.md). Read those for detail —
this doc is the ordered "what to actually do" list.

## The model: keep default URLs now → one env flip at cutover

The whole stack is **env-driven**. Today it runs on the default hosting URLs
(`*.up.railway.app` for the backend, `*.vercel.app` for the frontend). At cutover you
change a handful of **environment variables in the dashboards** and update a few external
services — **no code changes, no redeploy triggered by code**. Everything below is
reversible.

There is deliberately **no `dev.autobacsindia.com` staging subdomain** — it would just be
re-done on the real hostname. Local dev + the default prod URLs are the two tiers.

---

## What runs in production (so nothing is forgotten)

The three services you stand up new:

- **Railway** — backend API.
- **Vercel** — frontend (Next.js).
- **Postmark** — transactional email.

Backing services that are already live and **don't change** at cutover: **MongoDB Atlas,
Redis (Upstash cache + queue), Elasticsearch, Cloudinary, Razorpay, Google OAuth**.
**Cloudflare** only enters the picture when the domain moves (Step 3).

---

## Step 0 — Email now (do this ~1–2 weeks BEFORE cutover)

Postmark's code is already wired to env vars; you only need values + domain
authentication. This is safe to do now because the live WooCommerce site sends from a
plain `info@autobacsindia.com` mailbox, **not** domain-authenticated sending — so adding
Postmark's email DNS records does not touch WooCommerce or the website.

### 0a. Postmark dashboard
1. Create/confirm a **Server** → copy its **Server API Token** (`POSTMARK_SERVER_TOKEN`).
2. **Sender Domains → Add Domain** `autobacsindia.com`. Postmark shows a **DKIM** record
   and a **Return-Path (custom bounce) CNAME**.

### 0b. Hostinger DNS (email records only — website untouched)
In Hostinger → **Domains → autobacsindia.com → Manage DNS records**:
1. **DKIM** — add the `TXT`/CNAME Postmark gives, exactly.
2. **Return-Path** — add the CNAME Postmark gives (e.g. `pm-bounces → pm.mtasv.net`).
3. **SPF** — find the existing `TXT` starting `v=spf1`. **Do NOT add a second SPF record.**
   Merge Postmark in: `v=spf1 include:spf.mtasv.net <existing includes> ~all`. If none
   exists: `v=spf1 include:spf.mtasv.net ~all`.
4. **DMARC** — if no `_dmarc` `TXT` exists, add monitor-only:
   `v=DMARC1; p=none; rua=mailto:dmarc@autobacsindia.com`. (Rejects nothing — safe.)
5. Wait for propagation, click **Verify** in Postmark until DKIM + Return-Path go green.

### 0c. Set values in Railway (backend)
```
POSTMARK_SERVER_TOKEN=<token>
POSTMARK_FROM_EMAIL=noreply@autobacsindia.com     # or hi@autobacsindia.com
POSTMARK_FROM_NAME=Autobacs India
POSTMARK_MESSAGE_STREAM=outbound
ENABLE_EMAIL_NOTIFICATIONS=true
# Invoice/company details printed on the PDF:
COMPANY_NAME=Autobacs India
COMPANY_GSTIN=...
COMPANY_ADDRESS=...
COMPANY_CITY=...  COMPANY_STATE=...  COMPANY_PINCODE=...
COMPANY_PHONE=...  COMPANY_EMAIL=support@autobacsindia.com
# Optional: also archive invoice PDFs to Cloudinary (email always attaches the PDF regardless):
INVOICE_STORE_CLOUDINARY=false
```
Then send a few real test emails (password reset, place a test order) so Postmark warms
up the sender reputation before launch day. **Cold-starting email on launch day = order
receipts landing in spam.**

> Invoice/receipt emails: an invoice PDF is generated and emailed automatically on
> **payment success** (Razorpay `payment.captured` webhook → order `confirmed`). It is
> idempotent (`Order.invoiceEmailedAt`). Nothing to configure beyond the `COMPANY_*` vars.
>
> Re-download: admins (any order) and customers (their own) can download the invoice any
> time via `GET /api/v1/orders/:id/invoice` — the button is on the admin order detail page
> and the customer's `/orders/[id]` page. The PDF is regenerated on demand behind auth, so
> no public URL exposes customer PII and it works for every order. `INVOICE_STORE_CLOUDINARY`
> stays optional/off — it's not needed for this.

---

## Step 1 — Backing services on prod region (already covered)

Redis split (Upstash cache + dedicated queue Redis) and the Mumbai region rule are in
[RUNBOOK-cdn-redis-vercel.md](RUNBOOK-cdn-redis-vercel.md) Steps 1–2. Ensure `REDIS_URL`
(must be `rediss://` for Upstash) and `QUEUE_REDIS_URL` are set on Railway. The invoice
email runs on the BullMQ worker, which needs `REDIS_URL`.

---

## Step 2 — Frontend on Vercel with default URL (pre-cutover)

Import `Front-end/web` into Vercel (framework auto-detected, region **bom1** / Mumbai).
Set on Vercel:
```
NEXT_PUBLIC_API_URL=https://<backend>.up.railway.app      # Railway default URL for now
NEXT_PUBLIC_APP_URL=https://<project>.vercel.app          # Vercel default URL for now
JWT_SECRET=<identical to backend prod JWT_SECRET>
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_...                  # matches backend tier
NEXT_PUBLIC_ALLOW_WP_IMAGES=true                          # while apex still on WordPress
```
Set on Railway (CORS): `FRONTEND_URL` + `FRONTEND_URLS` = the Vercel URL. Smoke-test:
log in → cart → test Razorpay order. Cookies run `SameSite=none` (two different domains).

---

## Step 3 — Cutover day: move the domain (the single env flip)

### 3a. Cloudflare + DNS
1. Add the zone in Cloudflare; let it import Hostinger's records; **diff and fix** — make
   sure MX/SPF/DKIM/DMARC/Return-Path (the[text](vscode-webview://1c033tgps7p8tb6ljdn1aucms2eiinli5me2hcvjj53gigtb59cg/docs/SMOKE-TEST-runbook.md) Step 0 email records) all came across. A
   missing email record = silent mail failure.
2. Change nameservers at Hostinger → Cloudflare.
3. Records:
   - `@` and `www` → Vercel (add + verify domain in Vercel), **DNS-only (grey cloud)**.
   - `api` → CNAME → Railway backend, **proxied (orange cloud)**.
4. SSL/TLS → **Full (strict)**. Enable WAF + Bot Fight Mode + rate limiting (see the CDN
   runbook Step 5 for detail).

### 3b. Flip environment variables (no code change)

| Where | Variable | New value |
|---|---|---|
| Vercel | `NEXT_PUBLIC_API_URL` | `https://api.autobacsindia.com` |
| Vercel | `NEXT_PUBLIC_APP_URL` | `https://autobacsindia.com` |
| Vercel | `NEXT_PUBLIC_ALLOW_WP_IMAGES` | `false` (once images are on Cloudinary — see Step 4) |
| Railway | `FRONTEND_URL` | `https://autobacsindia.com` |
| Railway | `FRONTEND_URLS` | `https://autobacsindia.com,https://www.autobacsindia.com` |
| Railway | `GOOGLE_CALLBACK_URL` | `https://api.autobacsindia.com/api/v1/auth/google/callback` |
| Railway | `COOKIE_DOMAIN` | `.autobacsindia.com` |
| Railway | `COOKIE_SAMESITE` | `lax` |
| Railway | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | `rzp_live_...` |
| Railway | `RAZORPAY_WEBHOOK_SECRET` | live webhook secret |
| Vercel | `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_live_...` (match backend) |

Redeploy frontend on Vercel so the new `NEXT_PUBLIC_*` values bake in.

### 3c. External dashboards to update (not env vars)
- **Google OAuth**: add the prod redirect URI `https://api.autobacsindia.com/api/v1/auth/google/callback`.
- **Razorpay**: point the webhook to `https://api.autobacsindia.com/...` and switch to Live mode.
- **Postmark**: re-verify the email records survived the Cloudflare import.

### 3d. Verify on the real domain
- Log in (Google + password) → cart → **place one real (small) order** → confirm the
  invoice email arrives with a correct PDF.
- Flush Redis `route:*` / `public:*`.

---

## Step 4 — Legacy WordPress images

`autobacsindia.com/wp-content/**` images die when the apex leaves WordPress. **Migrate any
remaining logos/images to Cloudinary first**, then set `NEXT_PUBLIC_ALLOW_WP_IMAGES=false`
on Vercel and redeploy. (The allowlist is env-gated in `next.config.ts`, so this needs no
code edit.)

---

## Where NOT to change anything

- **Never hardcode a host in code.** All hosts come from env (`NEXT_PUBLIC_API_URL`,
  `FRONTEND_URL(S)`, `GOOGLE_CALLBACK_URL`, `COOKIE_DOMAIN`). The OAuth redirect now
  **fails safe** if `FRONTEND_URL` is unset in prod (no stale fallback host).
- **Don't set `MONGODB_URI` in Railway prod** — scripts read that name and could hit prod.
  Runtime uses `MONGO_URI`.
- **Host-injected vars** (`RAILWAY_*`, `VERCEL_*`, `PORT`, `CI`) — never set by hand.
- **`WORDPRESS_*` / `WOOCOMMERCE_*`** — migration scripts only; keep out of prod runtime.
- **`JWT_SECRET`** must be **identical** between frontend and backend within a tier, and
  **different** across tiers. Rotating it means updating both apps together.

---

## Rollback

DNS moves are reversible: switch nameservers back to Hostinger (keep WordPress origin
reachable during the transition, low TTL). The old Railway frontend service stays stopped
(not deleted) as a fallback. Env flips are reversible in the dashboards.
