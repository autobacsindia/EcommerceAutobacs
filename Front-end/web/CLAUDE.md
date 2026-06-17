# CLAUDE.md — Frontend (`web`)

Next.js 15 App Router, React 19, TypeScript, Tailwind v4. Deploys to Railway (Docker).

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
- `context/` — React Context state: `AuthContext`, `CartContext`, `WishlistContext`, `LocationContext`, `CurrencyContext`, `RateLimitContext`.
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
