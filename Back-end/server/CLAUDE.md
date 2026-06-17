# CLAUDE.md — Backend (`autobacs-server`)

Express + MongoDB (Mongoose) REST API. ESM (`"type": "module"` — use `import`, `.js` extensions in paths). Deploys to Railway (Docker).

## Commands

- `npm run dev` — nodemon + dotenv.
- `npm start` — `node --import=dotenv/config server.js`.
- `npm run lint` — eslint `controllers/ routes/ services/`, zero warnings.
- `npm test` — jest (experimental VM modules). `npm run test:coverage` — must hold 60% line floor (enforced in `jest.config.js`, gates CI/deploy).
- Tests use `mongodb-memory-server` + `supertest`; external integrations (Cloudinary, Razorpay, SendGrid) are mocked — no real secrets needed.

## Entry / wiring

- `server.js` — bootstrap: env validation, DB connect-with-retry, Sentry, queue workers, then starts `app`.
- `app.js` — Express app, middleware chain, mounts `apiRouter` at `/api/v1`. Middleware order matters (CSP nonce → helmet → compression → cookies → raw webhook body → CSRF → CORS → json → sanitize). Razorpay webhook mounted with `express.raw` BEFORE CSRF/json on purpose.
- `routes/index.js` aggregates all `/api/v1/*` routers. v2 would mount separately.

## Structure

- `models/` — Mongoose schemas (Product, Order, User, Cart, Vehicle, Category, Brand…).
- `controllers/` — request handlers (note: not every route has one; many routes inline logic).
- `routes/` — per-domain routers.
- `services/` — business logic: order, product, search (Elasticsearch), cache (Redis/ioredis), email/SMS, razorpay, locations, imports, cron.
- `middleware/` — auth, rate-limit, CSRF, sanitization, caching, security hardening, audit.
- `queue/` — BullMQ workers (notification, order, search-sync).
- `config/`, `utils/`, `helpers/`, `validators/`, `repositories/`, `scripts/`.

## Conventions

- All API paths live under `/api/v1`. Frontend depends on this prefix.
- Async route handlers wrapped with `asyncHandler`; errors flow to `errorMiddleware`.
- Many top-level `*.js` are one-off migration/import/diagnostic scripts (WooCommerce migration, category mapping, etc.), not app code. Wired as npm scripts. Don't import them into the server.
- WooCommerce→Mongo migration is an active workstream; see `WOOCOMMERCE_MIGRATION_USER_GUIDE.md` + `scripts/`.
- Secrets via env only; rotation in `SECRETS_ROTATION_GUIDE.md`.
