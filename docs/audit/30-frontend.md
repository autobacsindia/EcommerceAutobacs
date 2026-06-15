# 30 — Frontend

_Phase 1. Stack: Next.js 15.3.9 (App Router), React 19, TypeScript (`strict: true`), Tailwind v4, `next-pwa`, Sentry. `output: 'standalone'`._

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| F1 | P1 | 195 of 313 `.tsx` files have `'use client'` (62%) | Heavy under-use of React Server Components — most of the tree ships to the client. Hurts bundle size, TTFB, SEO, and forfeits a primary Next 15 advantage | Audit client boundaries; push data-fetching + static UI to Server Components; keep `'use client'` only where interactivity needs it |
| F2 | P2 | `admin/products/edit/[id]/page.tsx` 1547, `model/[slug]/page/[page]/page.tsx` 817, `products/[slug]/ClientPage.tsx` 796, `admin/products/create/page.tsx` 784, `checkout/page.tsx` 714 | God components mixing fetching, state, and presentation | Extract data hooks + presentational subcomponents; share logic between create/edit admin pages |
| F3 | P2 | `grep http://\|localhost:` in `src` = 29 hits (excl. tests) | Hardcoded URLs/localhost in source → environment coupling | Route all through `NEXT_PUBLIC_*` env + a single API base helper (`lib/http`) |
| F4 | P2 | `package.json`: `@sentry/nextjs ^10.39` vs `@sentry/node ^8.55` + `@sentry/react ^8.55` | Mixed Sentry major versions risk runtime/type conflicts | Standardize on `@sentry/nextjs` 10.x; drop redundant `@sentry/node`/`@sentry/react` on FE |
| F5 | P3 | `src/integration-tests/`, `src/app/integration-tests/`, `src/tests/` | Three overlapping test locations | Consolidate test dirs; keep e2e in `tests/e2e` |
| F6 | P3 | 29 `*.md` files in `Front-end/web/` root | Doc sprawl (see `99-docs.md`) | Fold into `/docs` |

## Strengths
- **TypeScript `strict: true`** — good baseline type safety.
- **Not coupled to WordPress at runtime** — UI consumes the Express API, not `wp-json`. This materially de-risks the WP migration (frontend doesn't need to change when WP is retired).
- a11y testing present: `jest-axe` + `@axe-core/react`, `test:a11y` script.
- Data fetching consolidated through a `lib/http` wrapper (direct `axios` import in only 1 component; `fetch()` in ~16) — reasonable.
- React Compiler (`babel-plugin-react-compiler`) enabled.

## Rendering / migration fit (feeds ADR-001)
- App Router + `output: 'standalone'` → Vercel-native. ISR/SSR achievable but currently undercut by F1 (over-clientization).
- Dynamic content: product/model/category pages are dynamic (API-driven); strong ISR candidates → favors Vercel.
- PWA + Sentry both Vercel-compatible.

## Open items
- Core Web Vitals not measured here — run Lighthouse/`@next/bundle-analyzer` (`npm run analyze`) in a perf pass.
- Image handling: large hero/vehicle images historically committed (now Cloudinary per recent commits) — verify all `<Image>` use optimized sources.
