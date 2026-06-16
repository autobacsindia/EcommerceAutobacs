# ADR-001 Evidence — Vercel migration readiness (read-only)

_Date: 2026-06-15 · Auditor: Claude Code · No code/config/hosting changed._

**Bottom line: ADR-001 can move to ACCEPTED as-is.** There is **one** serverless FLAG (`/api/warmup` fire-and-forget) and it is a **Railway-specific** route that should simply be dropped on Vercel — not a code defect. No route opens a DB connection, holds a long-lived socket, writes to the filesystem, or depends on heavy compute. Migration steps need two small additions (see §4).

---

## 1. Serverless-safety audit — `src/app/api/*`

Only **4** route handlers exist. None declare `export const runtime` → all use the **default Node.js runtime** (good; no Edge constraints).

| Route | Methods | Runtime | DB conn | Long-lived conn | FS write | Post-response work | Duration risk | Verdict |
|---|---|---|---|---|---|---|---|---|
| `/api/health` | GET | nodejs (`dynamic='force-dynamic'`) | none | none | none | none | none | **PASS** |
| `/api/warmup` | GET | nodejs | none | none | none | **YES** — `Promise.allSettled([...])` is intentionally **not awaited**; returns 200 immediately, sitemap fetches run after response | bg fetch `AbortSignal.timeout(60000)` (not awaited) | **FLAG** |
| `/api/products/suggestions` | GET | nodejs | none (proxies backend via `fetch`) | none | none | none | upstream `fetch` 30s timeout | **PASS** (see note) |
| `/api/revalidate/warehouses` | POST | nodejs | none | none | none | none | trivial | **PASS** (see note) |

### Detail
- **`/api/health`** — returns `{status:'ok', timestamp}`. Trivial. PASS.
- **`/api/warmup`** — Railway health-check that *also* pre-warms sitemap shards via fire-and-forget fetches to `/sitemap/0.xml`, `/sitemap/1.xml`. **On Vercel the function freezes after the response is sent**, so the un-awaited background fetches are unreliable/killed → the pre-warm silently won't happen.
  - **Why it exists:** cold-start mitigation for Railway's container + a cold backend; returns 200 fast so the health check never times out.
  - **Remediation:** **drop `/api/warmup` entirely on Vercel.** It is unnecessary — `sitemap.ts` already uses ISR (`fetch(..., { next: { revalidate: 3600 } })`), so sitemap shards are cache-warmed on demand without a warmer. (If a warmer is ever wanted, use Next 15 `after()` or a Vercel Cron, not fire-and-forget.)
- **`/api/products/suggestions`** — pure proxy to `${BACKEND_API_URL}/products/suggestions` with a 30s AbortController timeout; returns 408 on timeout, 500 on error. No DB/FS. PASS.
  - **Note:** uses server-side env `BACKEND_API_URL` (default `localhost:5000`) — **must be set in Vercel** project env. 30s upstream timeout exceeds the **Hobby** 10s function cap; fine on **Pro** (configurable `maxDuration`). Lower the timeout or set `maxDuration` if needed.
- **`/api/revalidate/warehouses`** — `revalidateTag('warehouses')`; on-demand ISR, fully Vercel-native. PASS.
  - **Note (security, not serverless):** endpoint is **unauthenticated** — anyone can POST to force revalidation. Add a shared-secret/token check. Not a blocker for the move.

**Primary serverless failure mode (per-invocation Mongo `connect()` with no global cache): NOT PRESENT.** The frontend never talks to Mongo directly — all data flows to the Express backend via the `next.config.ts` rewrite `/api/v1/:path*` → `${NEXT_PUBLIC_API_URL}` and via these proxy routes.

---

## 2. Build / runtime compatibility on Vercel

- **`next-pwa`: ALREADY DISABLED.** `next.config.ts` line 4: *"PWA disabled — @ducanh2912/next-pwa removed."* No service worker is generated. → **No Vercel PWA concern.** The `@ducanh2912/next-pwa` dependency in `package.json` is **dead** — remove it (tooling cleanup, not a blocker).
- **`output: 'standalone'`** — a self-host/Docker setting, **ignored by Vercel**. Safe to leave; cleaner to remove during migration.
- **`images.unoptimized: true`** — Next image optimization is **off**; images are served by **Cloudinary** (allowlisted `res.cloudinary.com/dhwxtl6l8/**`). Directly relevant to cost (§3).
- **`middleware.ts` — Edge-safe.** Uses `jose` (`jwtVerify`, explicitly edge-compatible) and `NextResponse`; **no Node-only crypto** (`randomBytes`/`require('crypto')`) found. Runs fine on Vercel's Edge runtime. *(Caveat: the `next.config.ts` comment claims middleware sets a per-request CSP nonce, but no `nonce`/`crypto` reference was found in `middleware.ts` — the comment may be stale. Worth a team check; not a Vercel blocker.)*
- **`rewrites()`** (`/api/v1/:path*` → backend) — Vercel-supported; this is the main FE→BE data path and works unchanged.
- **`compiler.removeConsole` in prod**, `reactStrictMode`, bundle-analyzer — all Vercel-compatible.

### `NEXT_PUBLIC_*` and server env vars (build-time vs runtime)
`NEXT_PUBLIC_*` are **inlined at build time** — none are expected to change at runtime (confirmed: all are config/keys, not mutable state):
- `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_LOGROCKET_APP_ID`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`.

Server-side env vars (must be set per Vercel environment, used at request time):
- `BACKEND_API_URL` (suggestions proxy), `NEXT_PUBLIC_APP_URL` (warmup self-fetch — moot if warmup dropped), `NODE_ENV`.

### Sentry
Mixed majors: `@sentry/nextjs ^10.39` + `@sentry/node ^8.55` + `@sentry/react ^8.55`. **Recommended target for a clean Vercel + Next 15 setup:** keep **`@sentry/nextjs` 10.x only** (it bundles the node/react integrations); remove standalone `@sentry/node` and `@sentry/react` from the frontend. Verify sourcemap upload + `environment` tag per Vercel env. (Recommendation only.)

---

## 3. Cost-model inputs

What in the codebase drives Vercel usage:
- **Image optimization units: ~$0 as currently configured.** `images.unoptimized: true` bypasses Vercel's optimizer; the 27 `next/image` usages pull pre-optimized assets from Cloudinary. (If you later flip optimization ON at Vercel, those 27 components × distinct source images would begin consuming image-optimization units.)
- **Function invocations / duration drivers:**
  - The `/api/v1/:path*` **rewrite proxy** to the backend — the hot path (every client API call). Cheap per-call but volume-driven.
  - `/api/products/suggestions` proxy — fires on search/typeahead; can be frequent (per-keystroke if not debounced — check the search component).
  - Page rendering: product/model/category pages — whether they are **SSR vs ISR/SSG** is the biggest duration driver (and ties to finding F1: 62% client components). ISR/SSG dramatically lowers function cost.
  - `/api/revalidate/warehouses` — low volume (write-triggered).

**Numbers needed from you to model monthly cost** (do not have these — won't guess):
1. Monthly **page views** (and rough split: product/category/home).
2. **Peak RPS** / concurrent users.
3. Average **API calls per page** (drives `/api/v1/*` proxy invocations) and whether search typeahead is debounced (drives suggestions calls).
4. Whether product/category pages will be **ISR/SSG or SSR** post-migration.
5. (Only if enabling Vercel image optimization) average **distinct images per page** + monthly image requests.

With (1)–(4) the Vercel Pro estimate is straightforward; image-opt cost stays $0 unless you change the Cloudinary setup.

---

## 4. Verdict & required ADR-001 step changes

**Move ADR-001 to ACCEPTED.** No blocking serverless issues. Update the migration steps with these (all small, none blockers):

1. **Drop `/api/warmup`** on Vercel (Railway-only; sitemap already ISR-cached). Remove the `/api/warmup` healthcheck reference.
2. **Set server env vars in Vercel:** `BACKEND_API_URL` (+ keep `NEXT_PUBLIC_*` per env). Confirm `/api/products/suggestions` timeout vs plan (`maxDuration` on Pro, or lower the 30s).
3. **Add a secret/token** to `/api/revalidate/warehouses` (defense-in-depth; do during migration).
4. **Dead-code cleanup (non-blocking):** remove `@ducanh2912/next-pwa` dep, optionally drop `output: 'standalone'`, standardize Sentry to `@sentry/nextjs` 10.x.
5. Verify the `next.config.ts` CSP-nonce-in-middleware comment vs actual `middleware.ts` (possible stale comment).

**Confidence: High.** The frontend is cleanly decoupled (no direct DB, no stateful API routes, Edge-safe middleware, image cost neutralized by Cloudinary). The only Railway-specific construct (`warmup`) is disposable.
