# Phase 5 — Frontend (2026-07)

_Auditor: Claude Code · Date: 2026-07-09 · Read-only, findings only._

**Verdict: frontend security is solid** — XSS surfaces are handled, auth uses httpOnly cookies, no client secret leakage. **One P2** (fail-open revalidate endpoint) and a few P3s.

## Verified strengths (evidence)

| Area | Evidence | Status |
|---|---|---|
| JSON-LD XSS | `serializeJsonLd` escapes `<`,`>`,`&` → `<` etc. → no `</script>` breakout (products/[slug], [slug]) | ✅ safe |
| Blog HTML XSS | `ArticleDetailClient.tsx:143` renders only `DOMPurify.sanitize(article.content)`; raw content never hits the DOM | ✅ sanitized |
| No client secrets | `NEXT_PUBLIC_*` = API/APP URL, Maps key, PostHog/LogRocket, Razorpay **KEY_ID** (public by design). No secrets. | ✅ |
| Auth token storage | httpOnly cookies + `credentials:'include'`; "no JS token is set" (AuthContext.test); admin uses `cookies()` | ✅ XSS-safe |
| No hardcoded host | All API access via `getServerApiBase()` / `NEXT_PUBLIC_API_URL`; grep for railway/api hosts in `src/` = clean | ✅ contract honored |
| Cart orphan safety | BE filters items where `!item.product \|\| !isActive \|\| stock==OUT` **before** returning (`routes/cart.js:53-54,431,511`) → FE never sees dangling refs (closes Phase-4 carry-over) | ✅ |

## Findings

| ID | Sev | File | Issue | Fix |
|----|-----|------|-------|-----|
| **FE-1** | **P2** | `src/app/api/revalidate/home/route.ts:28-33` (+ `warehouses/route.ts`) | **Fail-open auth:** `if (!expected) return true; // not configured -> open`. `REVALIDATE_SECRET` is not in the env contract and unset locally. If prod (Vercel) also omits it, anyone can POST/GET the route → `revalidateTag` + `revalidatePath('/')` on demand → **home-page cache-stampede DoS** (forces ISR regeneration + backend refetch per call). Tag is allowlisted (can't revalidate arbitrary tags), so bounded but still abusable. Connects to the "poisoned Data Cache" memory. | **Fail-closed in production:** if `REVALIDATE_SECRET` is unset, deny (500/403) rather than open. Set the secret in Vercel + Railway. Apply to the `warehouses` route too (its authorize check needs verifying — grep found no secret gate). |
| FE-2 | P3 | `admin/products/edit/[id]/page.tsx:448`, `src/lib/orderStatusUpdate.ts:56` | Dead `localStorage.getItem('authToken')` fallbacks. Token is **never written** to localStorage (grep: no `setItem`), so these return null — but they're a **regression smell** inviting a future dev to store the JWT in localStorage (XSS-stealable). | Remove the localStorage fallbacks; rely solely on httpOnly cookies. |
| FE-3 | P3 (SEO) | `src/components/blog/ArticleDetailClient.tsx:138-143` | Article HTML is sanitized **client-side only** (to dodge isomorphic-dompurify SSR crash), so body content is **absent from SSR HTML** → weaker SEO / slower LCP for article bodies. | Sanitize server-side with `sanitize-html` (already a BE dep) so content is server-rendered; keeps XSS protection while restoring SSR/SEO. |

## Operational note (cannot verify from code)
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is publicly shipped (correct for Maps JS), but **must be HTTP-referrer-restricted** to `autobacsindia.com` in Google Cloud console, else it's abusable/billable by anyone. Verify the restriction. (Same discipline for the PostHog/LogRocket keys — those are ingestion-only, lower risk.)

## Deferred / not verified here
- Guest-cart-merge race on login (memory: `POST /cart/merge` unions guest→user) — trace concurrency in testing phase.
- Error/loading boundaries coverage on cart/checkout/PDP — spot-check in manual test phase.
- Accessibility pass on revenue pages — out of audit scope; testing-phase manual.

## Exit criteria
- [x] XSS surfaces (JSON-LD, blog) verified safe.
- [x] Client secret exposure verified absent.
- [x] Auth token storage (httpOnly cookie) verified.
- [x] Cart orphan null-guarding confirmed (BE-side filter).
- [ ] FE-1 (P2) + FE-2/3 (P3) → fix backlog.
