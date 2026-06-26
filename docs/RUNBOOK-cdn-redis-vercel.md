# Runbook — Upstash Redis split, Vercel frontend, Cloudflare CDN

Operational steps to take the code changes (already merged) to production. Order is
**safe and reversible** — each step is a no-op until its env vars are set, and Railway
Redis stays as rollback until Step 3 is verified.

**Region rule (applies to every stateful service): pick ONE region and use it everywhere
— Mumbai `ap-south-1` preferred, Singapore `ap-southeast-1` fallback.** A cross-region
cache hop defeats the purpose (every `cacheService.get` is a round-trip).

Env var names the code expects (all optional, with safe fallbacks):

| Var | Where | Purpose |
|---|---|---|
| `REDIS_URL` | Railway backend | Primary (Upstash) — cache + sessions + CSRF |
| `QUEUE_REDIS_URL` | Railway backend | Dedicated Redis — BullMQ + rate-limit (falls back to `REDIS_URL`) |
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

## Step 5 — Cloudflare CDN/WAF in front of the API

**Do NOT touch the live `autobacsindia.com` apex** (still on WooCommerce) until cutover.

### 5a. Now (pre-cutover) — stand it up on a hostname you control
1. Add a Cloudflare zone for a domain/subdomain you own (a staging domain, or pre-stage
   the future `api` record). Set the API record (e.g. `api-staging`) as a **proxied (orange
   cloud)** CNAME → the Railway backend host.
2. **SSL/TLS → Full (strict)** (Railway serves valid TLS). HSTS already emitted by the app.
3. **Cache rule** (Rules → Cache Rules):
   - Match: `http.request.uri.path matches "^/api/v1/" and http.request.method eq "GET"`.
   - Then: *Eligible for cache*, **Respect origin** TTL (uses the app's `s-maxage`).
   - **Bypass cache** when an auth cookie is present:
     add condition `not any(http.request.cookie.names[*] in {"accessToken" "refreshToken"})`,
     or a separate higher-priority rule that bypasses when those cookies exist.
   - Enable **Tiered Cache** (Caching → Tiered Cache).
4. **WAF / protection:** Managed Ruleset on, **Bot Fight Mode** on, a **Rate Limiting
   rule** at the edge (defense-in-depth above the app limiter), DDoS managed rules (default).
5. **Edge purge wiring:** create an API token scoped to *Zone → Cache Purge* for this zone.
   Set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` on the Railway backend so
   `npm run flush-cache` purges Redis **and** the edge together.
6. **Verify:** `curl -sI https://api-staging.<yourdomain>/api/v1/products` twice →
   `cf-cache-status: MISS` then `HIT`; with `-H 'Cookie: accessToken=x'` → `BYPASS`/`DYNAMIC`.
   Confirm `Cache-Control: …s-maxage=…` is present from origin.

### 5b. At cutover (when you own the domain)
1. Move `autobacsindia.com` DNS to Cloudflare (or add records there).
2. Records: apex / `www` → **Vercel** (per Vercel's domain instructions); `api` →
   **proxied CNAME → Railway backend**.
3. Add the domain in **Vercel → Project → Domains** and follow verification.
4. Flip env (no code change):
   - Backend (Railway): `COOKIE_DOMAIN=.autobacsindia.com`, `COOKIE_SAMESITE=lax`
     (now same-site → more secure + re-enables strict CSRF behavior), `FRONTEND_URL=https://autobacsindia.com`.
   - Frontend (Vercel): `NEXT_PUBLIC_API_URL=https://api.autobacsindia.com`. Redeploy.
5. Re-run the Step 3 auth smoke test on the real domain. Run `npm run flush-cache` (now
   also purges the edge). Keep the WooCommerce origin reachable briefly for rollback.

---

## Final verification checklist

- [ ] `x-cache: HIT` from the API (app Redis), `cf-cache-status: HIT` from Cloudflare.
- [ ] `x-vercel-cache: HIT` on pages.
- [ ] Auth + cart + test order pass on the new frontend domain.
- [ ] Upstash holds cache/session keys; dedicated Redis holds `bull:*` + `rl:*`.
- [ ] Login request → `cf-cache-status: BYPASS` (auth cookie not cached).
- [ ] `npm run flush-cache` reports both Redis deletions and `cloudflare — edge cache purged`.
- [ ] All four stateful services (Railway, Upstash, queue-Redis, Mongo) in the same region.
- [ ] Branch protection requires Frontend CI on `main`; `RAILWAY_FRONTEND_TOKEN` removed.
