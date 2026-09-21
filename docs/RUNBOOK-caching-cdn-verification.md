# RUNBOOK — Caching & CDN verification

Verifies the three-phase caching work end to end: the client router cache, the
Cloudflare edge purge and its cache-profile classification, and the ISR +
two-policy CSP change.

**Time:** ~25 min for the full pass · ~4 min for [Phase 1](#phase-1--automated-cli-pass) alone.

**Run on prod.** Every check here is read-only except [Phase 5](#phase-5--purge-on-write-p0),
which needs one harmless admin edit. Nothing here writes customer data.

> **Why a runbook rather than a test.** The failure this guards against is
> invisible to curl and to CI: a Content-Security-Policy that names a nonce over
> prerendered HTML returns HTTP 200 with correct-looking headers while the
> browser blocks **every script on the page**. [Phase 2](#phase-2--browser-csp-p0)
> is the only check that can see it, and it cannot be automated from a terminal.

---

## Contents

| Phase | What | Time | P0? |
|---|---|---|---|
| [0](#phase-0--preconditions) | Preconditions | 1 min | ✅ |
| [1](#phase-1--automated-cli-pass) | Automated CLI pass | 4 min | ✅ |
| [2](#phase-2--browser-csp-p0) | **Browser CSP** — the one that cannot be automated | 8 min | ✅ |
| [3](#phase-3--analytics-tags) | Analytics tags actually fire | 5 min | ✅ |
| [4](#phase-4--client-router-cache--prefetch) | Router cache + `<Link>` prefetch | 3 min | |
| [5](#phase-5--purge-on-write-p0) | Edge purge on write | 3 min | ✅ |
| [6](#phase-6--regression-guards) | Regression guards | 2 min | |
| [A](#appendix-a--what-each-failure-means) | What each failure means | — | |
| [B](#appendix-b--rollback) | Rollback | — | |

---

## Phase 0 — Preconditions

```bash
cd /path/to/EcommerceAutobacs
git fetch origin && git log --oneline -1 origin/main
```

The four caching commits must be ancestors of `main`:

```bash
for c in 6ea98f4a 37bceacc b4796235 6bfcb994; do
  printf "%s " "$c"
  git merge-base --is-ancestor $c origin/main && echo "on main" || echo "MISSING"
done
```

Set once for the rest of this document:

```bash
SITE=https://www.autobacsindia.com
API=https://api.autobacsindia.com/api/v1
PDP=/products/roav-aluminium-upper-control-arm   # any live product slug
```

---

## Phase 1 — Automated CLI pass

Everything a terminal *can* prove. Paste as one block.

### 1a. HTML is edge-cached (the headline)

Before this work every page answered `x-vercel-cache: MISS`, always.

```bash
for u in / /privacy /categories /brands "$PDP" /categories/accessories /products /cart; do
  curl -sS -o /dev/null -A "Mozilla/5.0" "$SITE$u" >/dev/null 2>&1   # warm
  printf "  %-46s " "$u"
  curl -sS -o /dev/null -D - -A "Mozilla/5.0" "$SITE$u" 2>&1 \
    | grep -iE "^x-vercel-cache|^age:" | tr '\n' ' ' | tr -d '\r'; echo
done
```

**Expected**

| Route | `x-vercel-cache` |
|---|---|
| `/`, `/privacy`, `/categories`, `/brands`, PDP, `/categories/<slug>` | **HIT** |
| `/products` (reads `searchParams`) | **MISS** — correct, it is dynamic |
| `/cart` | **MISS** — correct, forced dynamic |

A MISS on the first request is fine (cold edge); it must HIT on the second.

### 1b. CSP / render-mode pairing — the catastrophic pairing

```bash
for u in / /privacy "$PDP" /categories/accessories /login /products /cart; do
  hdr=$(curl -sS -o /tmp/p.html -D - -A "Mozilla/5.0" "$SITE$u" 2>/dev/null)
  code=$(echo "$hdr" | head -1 | awk '{print $2}')
  cspn=$(echo "$hdr" | grep -i content-security-policy | grep -c "nonce-")
  htmln=$(grep -o 'nonce=' /tmp/p.html 2>/dev/null | wc -l | tr -d ' ')
  v="ok"; [ "$code" = "200" ] && [ "$cspn" -ge 1 ] && [ "$htmln" -eq 0 ] && v="### BROKEN ###"
  printf "  %-44s %s  cspNonce=%s htmlNonces=%-3s %s\n" "$u" "$code" "$cspn" "$htmln" "$v"
done
```

**Expected** — public/static routes `cspNonce=0 htmlNonces=0`; `/cart` `cspNonce=1`
with **dozens** of `htmlNonces`.

**`### BROKEN ###` means every script on that page is blocked.** Stop and go to
[Appendix A](#a1--broken-in-phase-1b).

### 1c. No un-nonced external script on a strict route

This is the regression a code review caught: `gtag.js` shipped as a bare
`<script src>` with no nonce. `'strict-dynamic'` makes browsers ignore host
allowlists, so it was blocked on `/checkout` — silently killing `begin_checkout`.

```bash
curl -sS -o /tmp/cart.html -D /tmp/cart.hdr -A "Mozilla/5.0" "$SITE/cart"
node -e '
const fs=require("fs"),crypto=require("crypto");
const html=fs.readFileSync("/tmp/cart.html","utf8");
const csp=fs.readFileSync("/tmp/cart.hdr","utf8").split("\n").find(l=>/^content-security-policy/i.test(l))||"";
const hashes=new Set([...csp.matchAll(/sha256-([A-Za-z0-9+/=]+)/g)].map(m=>m[1]));
let checked=0, ok=0, bad=[];
for (const [,attrs,body] of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/nonce=/.test(attrs) || /ld\+json/.test(attrs) || !body.trim()) continue;
  checked++;
  const h=crypto.createHash("sha256").update(body,"utf8").digest("base64");
  hashes.has(h) ? ok++ : bad.push(body.slice(0,55).replace(/\n/g," "));
}
console.log("  CSP hashes advertised    :", hashes.size);
console.log("  inline nonce-less scripts:", checked, "| hash-covered:", ok);
const ext=[...html.matchAll(/<script([^>]*\bsrc=[^>]*)>/g)].filter(m=>!/nonce=/.test(m[1]));
console.log("  external scripts w/o nonce:", ext.length, ext.length?"  <-- BLOCKED":"  (none - correct)");
if (bad.length) { console.log("  UNCOVERED:"); bad.forEach(b=>console.log("    "+b)); }
'
```

**Expected:** `hashes advertised: 4`, `inline: 4 | hash-covered: 4`,
`external scripts w/o nonce: 0`.

Any uncovered inline script, or any external script without a nonce, is blocked
in the browser.

### 1d. Soft-404 guard

Adding a Suspense boundary or a `loading.tsx` above a `[slug]` route makes Next
flush the shell — committing HTTP 200 — before `notFound()` can throw. That
produced a site-wide soft 404 once already.

```bash
for u in /products/zzz-nope /categories/zzz-nope /brands/zzz-nope /zzz-nope /model/zzz-nope; do
  printf "  %-24s " "$u"; curl -s -o /dev/null -A "Mozilla/5.0" -w "%{http_code}\n" "$SITE$u"
done
```

**Expected:** `404` on all five. A `200` means Google will index junk URLs.

### 1e. Backend cache classification

```bash
for p in "/products?limit=12" "/categories" "/vehicles/makes" \
         "/reviews/testimonials" "/promo-banners/active"; do
  curl -sS -o /dev/null "$API$p" >/dev/null 2>&1   # warm
  h=$(curl -sS -o /dev/null -D - "$API$p" 2>&1 | tr -d '\r')
  printf "  %-24s cf=%-8s x-cache=%-5s %s\n" "$p" \
    "$(echo "$h" | grep -i '^cf-cache-status' | awk '{print $2}')" \
    "$(echo "$h" | grep -i '^x-cache'         | awk '{print $2}')" \
    "$(echo "$h" | grep -i '^cache-control'   | sed 's/cache-control: //I' | cut -c1-42)"
done
```

Each header is extracted separately on purpose: a single `grep | cut` truncates
the long `s-maxage=86400, stale-while-revalidate=…` value before
`cf-cache-status` is reached, which hides the very field this check is for.

**Expected**

| Endpoint | Class | Cache-Control | Cloudflare | Origin |
|---|---|---|---|---|
| `/products`, `/categories` | money path | `private, max-age=N` | `BYPASS` | `x-cache: HIT` |
| `/vehicles/makes`, `/reviews/testimonials` | purgeable | `s-maxage=86400` | `HIT` | `x-cache: HIT` |
| `/promo-banners/active` | purgeable (legacy mw) | `s-maxage=300` | `HIT` | — |

`x-cache` is the ORIGIN's Redis layer and is only meaningful when Cloudflare went
to origin; on a `cf=HIT` it is replayed from the cached response, so a blank or
stale-looking value there is expected, not a fault.

A money-path endpoint showing `s-maxage` means a price can sit at the edge with
no purge path. A `Set-Cookie` on any of these kills the whole cache layer — see
[A3](#a3--set-cookie-on-a-cacheable-get).

---

## Phase 2 — Browser CSP (P0)

**The only check that can detect a blocked script.** Everything in Phase 1 passes
on a page whose JavaScript is entirely dead.

### 2a. Public route

1. Open `$SITE/` → DevTools (<kbd>F12</kbd>) → **Console**.
2. Hard-reload (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).

**Pass:** no red `Refused to load … Content Security Policy` lines.
**Fail:** note the exact blocked URL — it is a host missing from `script-src` in
`Front-end/web/src/lib/csp.ts`.

Repeat on a PDP and a category page.

### 2b. Strict route — the important one

1. Sign in, add an item to the cart, open `/checkout`.
2. Console must be clear of CSP violations.
3. **Network** tab → filter `gtag` → `gtag/js` must be **200**, not `(blocked:csp)`.

This is where the bare-`<script src>` bug lived. A blocked `gtag/js` here means
`begin_checkout` never fires and the Ads funnel silently loses its middle step.

### 2c. Prove the pairing directly

On `/privacy` (statically rendered), paste into Console:

```js
document.querySelectorAll('script').length        // expect ~38
document.querySelectorAll('script[nonce]').length // expect 0
```

Then Network → click the document request → **Response Headers** →
`content-security-policy`:

- `/privacy` must **not** contain `nonce-`
- `/cart` **must** contain `nonce-`

A page whose CSP names a nonce while `script[nonce].length === 0` is completely
inert.

### 2d. Interactivity smoke test

CSP failures often look like "the page loaded but nothing works". Confirm on a PDP:

- image gallery switches
- variant/quantity selectors respond
- **Add to cart** updates the header badge
- the cart page renders line items and totals

---

## Phase 3 — Analytics tags

### 3a. Present in the served HTML

Tag-coverage checkers read the markup, not the rendered DOM. `next/script`
serialises tags into `self.__next_s` and replays them after hydration, which once
made live pages report as "untagged".

```bash
curl -sS -A "Mozilla/5.0" "$SITE/" > /tmp/home.html
for m in "googletagmanager.com/gtm.js" "googletagmanager.com/gtag/js" \
         "connect.facebook.net/en_US/fbevents.js" "gtmDataLayer" "s.async=true"; do
  printf "  %-42s %s\n" "$m" "$(grep -c -- "$m" /tmp/home.html | tr -d ' ')"
done
grep -oE "GTM-[A-Z0-9]+|AW-[0-9]+" /tmp/home.html | sort -u | sed 's/^/  id: /'
```

**Expected:** every marker ≥ 1, and the real `GTM-…` / `AW-…` ids.
`s.async=true` confirms `gtag.js` is **injected** by the hashed snippet rather
than sitting as a bare tag.

### 3b. They actually fire

With **Google Tag Assistant** and **Meta Pixel Helper**:

| Page | Expect |
|---|---|
| Home | `page_view`, Meta `PageView` |
| PDP | `view_item` |
| Add to cart | `add_to_cart` |
| `/checkout` | **`begin_checkout`** ← the one the CSP bug killed |
| Order success | `purchase` **exactly once** |

⚠ On order success, confirm `purchase` fires **once**. A webhook retry must not
double-count.

---

## Phase 4 — Client router cache + prefetch

**Router cache** — the original "spinning on every revisit" symptom:

1. Open `/products` → DevTools → **Network** → clear.
2. Click into a PDP, then press **Back**.
3. **Expected: no new document/RSC request.** The payload is reused for 60 s.

**Prefetch** — the payoff from `generateStaticParams`:

1. On `/products`, filter Network by **Fetch/XHR**.
2. Hover a product card **without clicking** → an RSC request fires for that PDP.
3. Click → near-instant paint.

CLI equivalent (the prefetch payload must be edge-cached):

```bash
curl -sS -o /dev/null -A "Mozilla/5.0" -H "RSC: 1" -H "Next-Router-Prefetch: 1" "$SITE$PDP" >/dev/null
curl -sS -o /dev/null -D - -A "Mozilla/5.0" -H "RSC: 1" -H "Next-Router-Prefetch: 1" "$SITE$PDP" 2>&1 \
  | grep -iE "^x-vercel-cache|^age:"
```

**Expected:** `x-vercel-cache: HIT`.

---

## Phase 5 — Purge on write (P0)

Proves `invalidateCache` reaches Cloudflare. Needs one harmless admin edit.

```bash
# 1. Warm the edge
for i in 1 2; do curl -sS -o /dev/null -D - "$API/vehicles/makes" 2>&1 | grep -i cf-cache-status; done
# expect: HIT
```

2. In admin, edit any **vehicle** (toggle a field and save — no data loss).

```bash
# 3. Within a few seconds
curl -sS -o /dev/null -D - "$API/vehicles/makes" 2>&1 | grep -i cf-cache-status
# expect: MISS  (the purge landed)
```

Still `HIT` after 30 s → the purge did not fire. Check `PUBLIC_API_URL`,
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` on Railway; all three are
required and the purge is a deliberate silent no-op without them.

> **Scope, stated plainly.** Only endpoints with a *closed* URL set are purgeable
> on the Free plan (exact-URL purge only): `/vehicles/makes`,
> `/reviews/testimonials`, `/promo-banners/active`. `/products` and `/categories`
> take varying `?limit=`/`?page=` values, so they carry **no** `s-maxage` instead.

---

## Phase 6 — Regression guards

```bash
cd Front-end/web && npm run lint && npm run test:ci
cd ../../Back-end/server && npm run lint && npm test
```

**Expected:** frontend 160 suites, backend 241 suites, 0 lint errors.

> Backend `npm test` is known to be flaky locally (mock leakage / DB isolation).
> A handful of failures that vanish on a clean re-run are not a regression.

The pairing guard needs a build, so it runs in CI after `npm run build`:

```bash
cd Front-end/web && npm run build
REQUIRE_BUILD_MANIFEST=1 npx jest src/app/cspRoutePairing.test.ts
```

**Expected:** every prerendered route asserted *not* on the strict-CSP list.

---

## Appendix A — What each failure means

### A1 — `### BROKEN ###` in Phase 1b
A route on `STRICT_CSP_PREFIXES` (`Front-end/web/src/lib/cspRoutes.ts`) is being
**prerendered**. A nonce cannot exist in prebuilt HTML, so the CSP names one no
script carries and `'strict-dynamic'` discards the `'self'` fallback → every
script blocked.

**Fix:** add `export const dynamic = 'force-dynamic'` to that segment's **server
`layout.tsx`**. ⚠ It is silently **ignored** in a `'use client'` `page.tsx` —
verified on a production build.

### A2 — A page loads but nothing is interactive
Almost always CSP. Go to [Phase 2c](#2c-prove-the-pairing-directly).

### A3 — `Set-Cookie` on a cacheable GET
`httpCache` refuses to store any response carrying `Set-Cookie`, so one stray
cookie disables **Redis and the CDN together** while every header still looks
deliberate. This caused a site-wide outage once.

```bash
for p in "/products?limit=12" /categories /brands /vehicles/makes; do
  printf "  %-24s set-cookie=%s\n" "$p" \
    "$(curl -sS -o /dev/null -D - "$API$p" 2>&1 | grep -ci '^set-cookie')"
done
```

**Every value must be 0.**

### A4 — A real product page returns 404
ISR **caches** 404s. A transient 429/5xx during on-demand generation used to
produce a permanent-looking 404 that survived the API recovering. `fetchEntityOrNull`
now treats only a literal 404 as "absent" and retries transients. If you see this,
check the API is healthy, then confirm the retry is intact in
`Front-end/web/src/lib/server-api.ts`.

### A5 — Everything is MISS again
Check the deploy actually landed (`git log --oneline -1 origin/main`), then that
`headers()` has not been reintroduced into `Front-end/web/src/app/layout.tsx` —
one call there opts **every route** in the app out of static rendering.

---

## Appendix B — Rollback

The work is four commits, each independently revertable:

| Commit | Scope | Revert impact |
|---|---|---|
| `6bfcb994` | ISR + two-policy CSP | Back to all-dynamic HTML; strict CSP everywhere |
| `b4796235` | Edge classification | Cache headers return to uniform `s-maxage` |
| `37bceacc` | Cloudflare purge | Edge becomes TTL-only again |
| `6ea98f4a` | Router cache + skeletons | Revisits refetch; listing skeletons disappear |

```bash
git revert --no-commit <sha> && git commit && git push origin develop
# then PR develop -> main
```

**Revert `6bfcb994` first** if the symptom is CSP- or ISR-shaped. Reverting it
alone leaves the backend caching work intact.

⚠ A push to `main` **is** the production deploy. Always go through a PR.

---

## Known gaps

- **Lighthouse has never been run** — no baseline and no after-measurement, so
  Core Web Vitals impact is unmeasured.
- **`sanitize-html` is pinned at 2.17.5** (2.17.6+ breaks Jest). The public CSP
  allows `'unsafe-inline'`, so this sanitizer is the **only** XSS control on
  public pages. 19 tests cover it (`tests/unit/utils/htmlSanitizer.cleanHTML.test.js`),
  but the pin should be revisited.
- **`/categories` declares `revalidate = 600` but gets 300** — the root layout's
  promo-banner fetch (`revalidate: 300`) caps every route, since a segment's
  window is the minimum of its own and its fetches'. Harmless; the 600 is inert.
