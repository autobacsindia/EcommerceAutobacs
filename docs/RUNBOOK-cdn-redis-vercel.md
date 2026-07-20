# Runbook — Upstash Redis split, Vercel frontend, Cloudflare CDN

Operational steps to take the code changes (already merged) to production. Order is
**safe and reversible** — each step is a no-op until its env vars are set, and Railway
Redis stays as rollback until Step 3 is verified.

> For the ordered go-live "what to actually do" checklist (email/Postmark setup, the
> keep-default-URLs-now → single-flip-at-cutover model, and the env change table), see
> [RUNBOOK-cutover-checklist.md](RUNBOOK-cutover-checklist.md). This doc is the infra detail.

**Region rule (applies to every stateful service): pick ONE region and use it everywhere
— Mumbai `ap-south-1` preferred, Singapore `ap-southeast-1` fallback.** A cross-region
cache hop defeats the purpose (every `cacheService.get` is a round-trip).

Env var names the code expects (all optional, with safe fallbacks):

| Var | Where | Purpose |
|---|---|---|
| `REDIS_URL` | Railway backend | Primary (Upstash) — cache + sessions |
| `QUEUE_REDIS_URL` | Railway backend | Dedicated Redis — BullMQ + rate-limit + CSRF (`middleware/csrfMiddleware.js` imports the rate-limit client; falls back to `REDIS_URL`) |
| `COOKIE_DOMAIN` | Railway backend | Unset now; `.autobacsindia.com` at cutover |
| `COOKIE_SAMESITE` | Railway backend | Unset now (→ `none` in prod); `lax` at cutover |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` | Railway backend | Optional — lets `flush-public-cache` purge the edge |
| `FRONTEND_URL` / `FRONTEND_URLS` | Railway backend | CORS allowlist — set to the Vercel URL |
| `NEXT_PUBLIC_API_URL` | Vercel frontend | Backend origin the Next rewrite proxies to |

---

## Step 1 — Provision Upstash (cache + sessions) and the dedicated queue Redis

1. **Upstash Redis** (https://console.upstash.com) → Create database:
   - Region: **Mumbai (ap-south-1)** (match Railway). Type: **Regional** (not Global —
     single region keeps latency low and avoids replication cost; revisit Global only if
     you go multi-region).
   - Eviction: **enable** `allkeys-lru` (it's a cache; safe to evict). TLS: on (`rediss://`).
   - Plan: **Fixed-price (Pro 2K or similar)** — NOT pay-as-you-go. Cache + sessions have a
     bounded command rate, and fixed price removes per-command bill surprises.
   - Copy the `rediss://…` connection string → this is `REDIS_URL`.
2. **Dedicated queue Redis** (BullMQ + rate-limit). Two options:
   - **(a) Railway Redis plugin** in the backend project, same region. Simplest; private
     networking; persistent TCP connections (what BullMQ needs). **Recommended.**
   - **(b) Upstash *dedicated* instance** (not serverless) in the same region.
   - Copy its connection string → this is `QUEUE_REDIS_URL`.

> Why two: BullMQ uses blocking commands + constant polling and rate-limiting does
> INCR+TTL on every request — millions of commands, expensive/fragile on serverless
> Redis. The code already routes these to `QUEUE_REDIS_URL`.

**Verify:** both reachable: `redis-cli -u "<url>" ping` → `PONG` (or use each console).

---

## Step 2 — Point the backend at the new Redis (Railway)

Do this **off-peak**; it restarts the backend.

1. Railway → backend service → **Variables**:
   - Set `REDIS_URL` = Upstash string.
   - Set `QUEUE_REDIS_URL` = dedicated Redis string.
   - Leave `COOKIE_DOMAIN` / `COOKIE_SAMESITE` **unset** for now.
2. Deploy / restart. Watch logs for:
   - `[Redis] connection ready` (cache client → Upstash)
   - `[Redis:rate-limit] connection ready` (rate-limit → dedicated)
   - `[Queue] …` workers connecting (BullMQ → dedicated)
3. **Verify the split:**
   - Hit a public endpoint twice: `curl -s -D- https://<railway-backend>/api/v1/products | grep -i x-cache` → `MISS` then `HIT`.
   - Cache/session keys land in **Upstash** (console → Data Browser: `public:*`, `route:*`, session keys).
   - `rl:*` and BullMQ keys (`bull:*`) land in the **dedicated** Redis.
   - Log in on the current frontend, confirm session works (sessions now on Upstash).

**Rollback:** set `REDIS_URL` and `QUEUE_REDIS_URL` back to the old Railway Redis; restart.

---

## Step 3 — Migrate the frontend to Vercel

The frontend has **no hardcoded backend host** — all API traffic goes through the
`next.config.ts` rewrite, so this is pure project + env setup.

1. **Import** the repo at https://vercel.com/new:
   - Root Directory: **`Front-end/web`**. Framework preset: **Next.js** (auto). Node 20.x.
   - Build command / output: defaults (Vercel detects Next; `output: 'standalone'` is
     ignored on Vercel — leave it).
2. **Environment Variables** (Production + Preview):
   - `NEXT_PUBLIC_API_URL` = current Railway **backend** URL for now
     (e.g. `https://<backend>.up.railway.app`). At cutover → `https://api.autobacsindia.com`.
   - `NEXT_TELEMETRY_DISABLED=1`. Add `SENTRY_AUTH_TOKEN` only if you want source-map upload.
   - Any other `NEXT_PUBLIC_*` the app reads (PostHog key, etc.) — copy from Railway.
3. **Region:** Project → Settings → Functions → **Region = Mumbai (bom1)** so SSR/ISR
   runs close to the backend + users.
4. **CORS on the backend (Railway):** set `FRONTEND_URL` (and `FRONTEND_URLS` for any extra
   origins) to the Vercel production URL, e.g. `https://<project>.vercel.app`. Without this,
   CORS blocks the new origin. (Preview URLs are wildcard-matched only if they're a
   subdomain of `FRONTEND_URL` — see `isAllowedSubdomain` in `app.js`; otherwise add them.)
5. **Deploy** (Vercel builds on push automatically). Then smoke-test the Vercel URL:
   - Pages load + are edge-cached: `curl -sI https://<vercel> | grep -i x-vercel-cache` → `HIT` on 2nd load.
   - `/api/v1/*` rewrite reaches the backend (open Network tab; calls are same-origin `/api/...`).
   - **Auth end-to-end:** log in → add to cart → place a *test* order. Cookies set and
     accepted (currently cross-site via `sameSite=none`; this is why the CSRF cookie fix
     matters). `/ingest/*` PostHog events flow.
   - Security headers + CSP nonce present (`curl -sI` → `content-security-policy`, HSTS).
6. **Decommission the Railway frontend service** only after the above passes (keep it
   stopped, not deleted, for a few days as rollback).

---

## Step 4 — Update CI/CD (DONE in repo — what it means + what you must do)

Already changed in this repo:
- `deploy.yml` — removed the `test-frontend` + `deploy-frontend` (Railway) jobs. Backend
  deploy is untouched.
- `ci-frontend.yml` — now runs on **all branches including `main`** (it used to skip main
  because deploy.yml covered it). This is the single source of frontend CI.

**You must do (one-time, in GitHub + Vercel):**
1. **Branch protection** (GitHub → Settings → Branches → `main`): require the Frontend CI
   checks (`Lint`, `Unit Tests`, `Build`) to pass before merge. This is what keeps `main`
   deployable now that Vercel auto-deploys on push to `main`.
2. **Vercel Git integration** (default on after import): Production Branch = `main`;
   preview deploys per PR are automatic.
3. **(Optional) gate Vercel prod deploy on CI**: Vercel → Settings → Git → *Ignored Build
   Step* with a command that exits non-zero unless CI passed, **or** rely on branch
   protection (simpler — main only ever gets vetted commits). Recommended: branch
   protection only.
4. **Remove the now-unused `RAILWAY_FRONTEND_TOKEN`** GitHub secret.

> Alternative (not recommended): deploy via Vercel CLI inside GitHub Actions
> (`vercel deploy --prod` with `VERCEL_TOKEN`) to gate deploy strictly on your GH tests.
> More maintenance and you lose Vercel's automatic preview deploys. Stick with the Git
> integration + branch protection unless you have a hard reason.

---

## Step 5 — Cloudflare at cutover (DNS + API security edge — NOT a CDN)

**Decision (after measuring the live stack):** Cloudflare is **not** our CDN. Two CDNs already
cover us — **Vercel's Edge Network** caches the frontend (pages' static assets are
`x-vercel-cache: HIT`, immutable) and **Upstash Redis** caches the API at the origin
(`x-cache: HIT`). With the same-origin `/api` proxy the browser never hits Railway directly;
Vercel's function (Mumbai) calls the backend (Mumbai) server-to-server, so edge-caching the
API saves only a co-located hop. So Cloudflare's job here is **DNS + a security shield on the
API origin**, and its API caching is an optional bonus, not the reason to use it.

Do this **at cutover only** — there's no value standing it up on a throwaway staging host
(you'd redo every rule on the real `api.` hostname). The DNS move to Cloudflare *is* the
cutover event. Until then, the repo is already prepped: `flush-public-cache.js` purges the
edge when `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID` are set (no-op until then), and the
origin emits `s-maxage` so the edge can cache if/when enabled.

> **Why NOT proxy the Vercel frontend through Cloudflare:** Vercel already provides global
> CDN, TLS, and DDoS. Putting Cloudflare's orange cloud in front of it double-proxies, breaks
> Vercel's cache/ISR headers, and buys nothing. **Apex/`www` → Vercel must be DNS-only (grey
> cloud).** Only `api` gets the orange cloud.

### 5a. Pre-flight BEFORE moving nameservers Hostinger → Cloudflare
Moving NS to Cloudflare migrates the **whole zone**. Get this right or you break email + the
live WooCommerce site:
1. In Hostinger DNS, **export/screenshot every record**. Cloudflare's onboarding auto-scans
   and imports, but **verify nothing is missed** — especially:
   - **Email (critical):** `MX`, the SPF `TXT` (`v=spf1 …`), **DKIM** `TXT`/CNAME (Postmark's
     `*._domainkey`), and the `DMARC` `TXT` (`_dmarc`). A missed record = silent mail failure
     (Postmark sends from `autobacsindia.com` — see [[postmark-email-setup]]).
   - Any domain-verification `TXT` (Google, etc.).
2. Keep **apex `@` / `www` exactly as-is, DNS-only (grey cloud)** → still pointing at the
   WordPress/WooCommerce host. The live site must not change.
3. Lower TTLs at Hostinger ~24h before the NS switch (faster rollback).

### 5b. At cutover — move DNS to Cloudflare and wire the API
1. Add the zone in Cloudflare, let it import, **diff against your Hostinger export** (fix any
   missing MX/SPF/DKIM/DMARC), then change nameservers at Hostinger → Cloudflare.
2. Records:
   - apex `@` / `www` → **Vercel** target, **DNS-only (grey cloud)**. Add the domain in
     **Vercel → Project → Domains** and follow its verification.
   - `api` → **CNAME → Railway backend host, proxied (orange cloud)**.
3. **SSL/TLS → Full (strict)** (Railway serves valid TLS). HSTS already emitted by the app.
4. **API security (the point of Cloudflare here):** on the `api` hostname — Managed WAF
   Ruleset on, **Bot Fight Mode** on, an edge **Rate Limiting** rule (defense-in-depth above
   the app limiter), DDoS managed rules (default). This also hides the Railway origin IP.
5. **(Optional) API edge cache** — only if you want it; it's marginal given co-location:
   - Cache Rule: match `starts_with(http.request.uri.path, "/api/v1/") and
     http.request.method eq "GET"` → *Eligible for cache*, **Respect origin** TTL.
   - **Bypass** when an auth cookie is present:
     `any(http.request.cookie.names[*] in {"accessToken" "refreshToken"})` → bypass.
   - Tiered Cache on.
6. **Edge purge wiring:** create an API token scoped to *Zone → Cache Purge*; set
   `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` on the Railway backend so `npm run
   flush-cache` purges Redis **and** the edge together.
7. **Flip env (no code change):**
   - Backend (Railway): `COOKIE_DOMAIN=.autobacsindia.com`, `COOKIE_SAMESITE=lax`
     (now same-site → more secure + re-enables strict CSRF behavior), `FRONTEND_URL=https://autobacsindia.com`.
   - Frontend (Vercel): `NEXT_PUBLIC_API_URL=https://api.autobacsindia.com`. Redeploy.
8. Re-run the Step 3 auth smoke test on the real domain. Run `npm run flush-cache`. Keep the
   WooCommerce origin reachable briefly for rollback (NS back to Hostinger if needed).

---

## Final verification checklist

- [ ] `x-cache: HIT` from the API (app Redis); `cf-cache-status: HIT` only if 5b.5 enabled.
- [ ] `x-vercel-cache: HIT` on **static assets** (`/_next/static/*`). The page **document**
      is `MISS` **by design** — see "Page caching decision" below; do not chase it.
- [ ] `x-vercel-id` shows `bom1::bom1` (function executes in Mumbai, co-located with backend).
- [ ] Auth + cart + test order pass on the new frontend domain.
- [ ] Upstash holds cache/session keys; dedicated Redis holds `bull:*` + `rl:*`.
- [ ] Cloudflare: apex/`www` **DNS-only**, `api` **proxied**; WAF + Bot Fight + edge rate-limit on.
- [ ] Email still flows after NS move (send a test) — MX/SPF/DKIM/DMARC imported correctly.
- [ ] Login request (if 5b.5 enabled) → `cf-cache-status: BYPASS` (auth cookie not cached).
- [ ] `npm run flush-cache` reports both Redis deletions and `cloudflare — edge cache purged`.
- [ ] All four stateful services (Railway, Upstash, queue-Redis, Mongo) + Vercel fn in Mumbai.
- [ ] Branch protection requires Frontend CI on `main`; `RAILWAY_FRONTEND_TOKEN` removed.

---

## Page caching decision (why page documents stay dynamic)

Investigated on the live Vercel deploy: every page is `x-vercel-cache: MISS` because the root
layout reads the per-request CSP nonce (`headers()` in `app/layout.tsx`), which Next stamps
onto **all** `<script>` tags (framework chunks + inline RSC) under `script-src 'nonce-…'
'strict-dynamic'`. Edge-caching that HTML would serve a **stale nonce** → the fresh
per-request CSP header rejects every script → broken page. The only way to cache it is to drop
the nonce and fall back to `script-src … 'unsafe-inline'` — a real XSS-protection downgrade on
a **payments** site, for a **modest** gain (JS/CSS/images are already edge-cached; API data is
Redis-cached; the dynamic part is a lightweight shell). **Decision: keep the strict nonce CSP,
leave page documents dynamic.** The high-value, zero-risk win was pinning the Vercel function
region to `bom1` (`vercel.json`) so the dynamic render is co-located with users + backend.
