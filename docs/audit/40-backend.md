# 40 — Backend / API

_Phase 1. Express 4 (ESM), Mongoose/MongoDB, Redis (ioredis), BullMQ, Elasticsearch. 34 routes, 11 controllers, 37 services, 26 models, 7 repositories._

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| B1 | P1 | `grep '.find('` in controllers/services = 32 unbounded; only 3 controllers use `.limit()/.skip()/paginate` | Many list queries are unbounded → memory/perf risk, DoS vector on large collections | Add pagination (limit + cursor/skip) to all list endpoints; cap max page size |
| B2 | P1 | `routes/auth.js` 1256 LOC | Auth god file mixing login, register, password reset, sessions, OAuth | Split by concern; move logic to `authController`/`authService` |
| B3 | P2 | `grep console.* controllers/services/routes/middleware` = 611; no winston/pino | Raw `console.*` logging, unstructured → see `95-observability.md` | Introduce structured logger (pino), redact PII |
| B4 | P2 | WP/Woo refs in `services/{brandProductImport,productImport,migrationOrchestration,categoryImport}Service.js`, `controllers/product{Import,Admin}Controller.js`, `routes/{products,index}.js` | WordPress migration code embedded in prod service layer; `@woocommerce/woocommerce-rest-api` dep | Isolate migration code behind a feature flag / separate module; plan removal post-migration (feeds ADR-003) |
| B5 | P2 | `controllers/orderController.js` 881, `services/orderNotificationService.js` 670 | Large order/notification files on the money path | Decompose; add focused tests (see `90-testing.md`) |
| B6 | P3 | `app.js` 945 LOC, 28 rate-limit references inline | App bootstrap carries too much inline config | Extract security/CORS/rate-limit wiring into `config/` modules |

## AuthN / AuthZ
- JWT-based (`jsonwebtoken`), `middleware/authMiddleware.js` (`protect`/`admin`). `bcryptjs` for hashing. Session store exists (`services/sessionStore.js` 630 LOC, Redis-backed). Guest checkout flow present.
- JWT secret rotated this session (prior memory). Confirm token expiry + refresh handling in the auth split (B2).

## Security middleware (strengths — verified wired in `app.js`)
- `helmet()` with **per-request CSP nonce** (`cspNonce.js`), `compression`, `cookieParser`.
- **CORS** via `corsOptions` (`app.options('*')` + `app.use(cors(corsOptions))`).
- **`express-mongo-sanitize`** wired via `sanitizationMiddleware.js`.
- **CSRF** via `csrfMiddleware.js` (correctly mounted *after* the Razorpay webhook raw-body route).
- **Body size limits**: `express.json({ limit: '500kb' })`, webhook `1mb` raw.
- `trust proxy` = 2 (Railway-aware). Extensive **rate limiting** (28 references) + Redis-backed store.
- Razorpay webhook uses `express.raw()` before JSON parser + signature verify — correct ordering.

## Performance
- Recent commits addressed an N+1 and added lean queries + Redis singleton (`93305cc`). B1 (unbounded finds) remains the main open perf risk.
- BullMQ queues (`queue/`, 5 files) for async work; Elasticsearch offloads search.

## Open items
- Verify per-route input validation coverage (A5 in architecture — 3 overlapping validation mechanisms).
- Confirm 4xx/5xx status-code correctness + consistent error envelope via `errorMiddleware.js`.
