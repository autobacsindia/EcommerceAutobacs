# CLAUDE.md — Frontend (`web`)

Next.js 15 App Router, React 19, TypeScript, Tailwind v4. Currently Railway (Docker); **migrating to Vercel** at `autobacsindia.com` (backend stays Railway at `api.autobacsindia.com`). Env-only move — set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` in prod; SEO fallbacks default to `https://autobacsindia.com`, local backend defaults to `:8080`. See root [CLAUDE.md](../../CLAUDE.md) "Migration status".

## Commands

- `npm run dev` — dev server.
- `npm run build` — `next build`. TS errors fail build (`ignoreBuildErrors: false`).
- `npm run lint` — `next lint` (ESLint skipped during build, so lint separately).
- `npm test` — jest. `npm run test:ci` — curated passing suites (`jest.ci.config.js` quarantines known-failing ones).
- `npm run test:e2e` — Playwright. `npm run test:a11y` — jest-axe.

CI order: lint → test → build (build gated on the first two).

## Structure (`src/`)

- `app/` — routes (App Router). Pages, layouts, `api/` route handlers.
- `components/` — UI, grouped by domain (checkout, products, orders, layout…).
- `context/` — React Context state: `AuthContext`, `CartContext`, `WishlistContext`, `CurrencyContext`, `RateLimitContext`.
- `hooks/` — `useAsync`, `useErrorHandler`, `useRazorpay`, `useSSE`.
- `lib/` — API clients (`api.ts`, `api-client.ts`), cart storage (Dexie), services, error handling, utils.
- `services/`, `utils/`, `types/`, `providers/`, `styles/`.

## Conventions

- Talk to backend through `lib/api*` clients — hit relative `/api/*`, which `next.config.ts` rewrites to `${NEXT_PUBLIC_API_URL}/api/v1/*`. No hardcoded backend host.
- `NEXT_PUBLIC_API_URL` is build-time baked (validated in Dockerfile). Local: set in `.env.local`.
- Guest cart is session-based, stored client-side (Dexie/`enhancedCartStorage`). Lots of historical fix-notes on this — verify against code.
- Sentry wired (`sentry.client/server.config.ts`); LogRocket via `providers/LogRocketProvider`.
- React Compiler enabled (`babel-plugin-react-compiler`).
- Watch hydration: SSR/client mismatches are a recurring source of bugs here.

## Client data fetching (TanStack Query)

Client-side reads go through **TanStack Query** (`providers/QueryProvider.tsx`, mounted in `app/layout.tsx`), not hand-rolled `fetch`-in-`useEffect`. Defaults: `staleTime` 60s, `gcTime` 5min, `retry` 1, no refetch-on-focus.

- **Keys**: always from the `hooks/queries/keys.ts` factory (`productKeys`, `categoryKeys`, `suggestionKeys`, …). Never inline a raw key array. Key namespaces mirror the backend cache tags on purpose.
- **Server → client handoff**: a server component that already fetched an entity (for metadata/JSON-LD) passes it to its client child as `initialData`/`initialProduct` so there's no duplicate client fetch or spinner (see `products/[slug]` and `categories/[slug]`). Wrap the shared server fetch in React `cache()`.
- **Mutations**: on success, `queryClient.invalidateQueries({ queryKey: <factory>.<prefix>() })` using the same key-factory prefix — the client-side mirror of the backend's `invalidateCache(tag)`.
- `lib/cacheService.ts` is the retired hand-rolled cache — do not add new consumers; migrate existing ones to `useQuery`.
