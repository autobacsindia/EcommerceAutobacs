# 00 — Discovery & Inventory

_Phase 0 of the Production-Readiness Audit. Read-only. Factual map only — no judgments here beyond what the evidence states. Auditor: Claude Code. Date: 2026-06-15._

> **Note on intended target architecture vs. reality:** the audit prompt assumed possible moves to Prisma + Neon (Postgres). **The backend today is MongoDB/Mongoose, not SQL.** This materially changes the DB ADR (it is a paradigm migration, not a Postgres-host swap). Flagged for Phase 2.

---

## 1. Repo shape

```
EcommerceAutobacs/
├── Back-end/
│   ├── server/        ← Express API (the real backend)
│   ├── coverage/      ← committed jest coverage output
│   ├── jest.config.js
│   └── test_output.txt
├── Front-end/
│   └── web/           ← Next.js 15 app (the real frontend)
├── frontend/          ← STRAY: contains only test-brand-page.html
├── .github/workflows/ ← 4 CI workflows
├── docs/audit/        ← (this audit, newly created)
└── ~42 *.md files + *.ps1 / *.bat / *.txt scripts at repo root
```

- **Monorepo?** Informal monorepo: two independent apps (`Back-end/server`, `Front-end/web`) each with its own `package.json` and lockfile. **No workspace tooling** — no npm/pnpm/yarn workspaces, no turbo, no nx. Each app installs independently.
- **Stray dirs:** `frontend/` (lowercase) holds a single `test-brand-page.html` — looks orphaned. `Back-end/coverage/` is committed coverage output.
- **Path naming inconsistency:** capitalized `Back-end/` and `Front-end/` vs. lowercase stray `frontend/`. One CI workflow (`ci-tests.yml`) references a non-existent `Autobacs/Back-end/...` prefix (see §5).

---

## 2. Languages & frameworks (from manifests)

### Backend — `Back-end/server/package.json`
- **Name/version:** `autobacs-server` `1.0.4-cache-bust` (version string used as a deploy cache-buster, not semver).
- **Type:** ESM (`"type": "module"`).
- **Runtime:** `engines.node >= 20.9.0`.
- **Framework:** Express `^4.21.2`.
- **Datastore:** MongoDB via Mongoose `^8.6.1`; Redis via `ioredis ^5.10.1`; `bullmq ^5` (job queues); `@elastic/elasticsearch ^8.15` (search).
- **3rd-party integrations:** `razorpay` (payments), `twilio` (SMS), `@sendgrid/mail` (email), `cloudinary` + `multer-storage-cloudinary` (media), `@woocommerce/woocommerce-rest-api` (WordPress/Woo migration source).
- **Security middleware libs:** `helmet`, `cors`, `express-rate-limit`, `express-mongo-sanitize`, `express-validator`, `sanitize-html`, `bcryptjs`, `jsonwebtoken`, `cookie-parser`.
- **Observability:** `@sentry/node` `^10.39`, `@sentry/profiling-node`.
- **Dev/test:** `jest ^30`, `supertest`, `mongodb-memory-server`, `nodemon`, `eslint ^9`, `artillery` (load testing). **No TypeScript on backend.**

### Frontend — `Front-end/web/package.json`
- **Name/version:** `web` `0.1.5-complementary-products` (version string again used as a build trigger).
- **Framework:** Next.js `15.3.9`, React `19.2.3`, React DOM `19.2.3`.
- **Language:** TypeScript `^5` (`tsconfig.json` present; `next-env.d.ts`).
- **Styling:** Tailwind CSS `v4` (`@tailwindcss/postcss`), `tailwind-merge`, `clsx`.
- **State/data:** `axios`, `react-hook-form`, `zod`, `dexie` (IndexedDB), `uuid`.
- **UI:** `framer-motion`, `lucide-react`, `react-icons`, `react-hot-toast`, `@tiptap/*` (rich text), `isomorphic-dompurify`.
- **PWA:** `@ducanh2912/next-pwa`.
- **Observability:** `@sentry/nextjs ^10.39`, `@sentry/node ^8.55`, `@sentry/react ^8.55`, `logrocket`. ⚠️ **Mixed Sentry major versions** (10.x nextjs vs 8.x node/react).
- **React Compiler:** `babel-plugin-react-compiler 1.0.0` present.
- **Testing:** `jest ^30`, `@testing-library/react`, `jest-axe` + `@axe-core/react` (a11y), `@playwright/test` (e2e).
- **Engines:** `node >= 20.9.0`.

### Other languages
- 1 Python file (`Back-end/server/check_mongo.py`) — incidental.

---

## 3. Runtime & OS assumptions

- **Node pinned** to `>=20.9.0` in both `engines` blocks. **No `.nvmrc`** in either app or repo root → local dev version is unpinned; relies on developer discipline.
- **Backend nixpacks.toml** pins `nodejs-20_x` + `npm-9_x`, build `npm install`, start `npm start`. **But `railway.toml` says `builder = "DOCKERFILE"`** → nixpacks files are present but **not used** by the active Railway build path (conflicting/dead config).
- **Dockerfiles:** both apps have `Dockerfile`; backend also has `Dockerfile.v2` (two versions committed).
- **OS-specific scripts:** large set of Windows `.bat`/`.ps1`/`.cmd` scripts (e.g. `start-mongodb*.bat/.ps1/.cmd`, `force-railway-redeploy.ps1`, `rotate-secrets.ps1`, `restart-frontend.bat`) → original dev environment was **Windows**. `.gitignore` is **UTF-16LE / CRLF** encoded (Windows artifact — see §5, this breaks git ignore parsing).

---

## 4. Entry points

- **Backend boot:** `Back-end/server/server.js`. Imports `connectWithRetry`/`preFlightIPCheck` from `config/db.js`, connects Mongoose (`await connectWithRetry()`), attaches extensive MongoDB pool-health event listeners, conditionally wires Redis when `NODE_ENV=production && REDIS_URL` set. App definition lives in `app.js` (945 LOC). A `server.minimal.js` also exists.
- **DB reached via:** `config/db.js` (Mongoose connection w/ retry + Atlas IP preflight check).
- **Frontend boot:** Next.js app-router (`src/app/`). `next.config.ts`, `middleware.ts` at app root. Procfile = `web: npm start` (→ `next start`). ⚠️ **`railway.toml` startCommand is `node server.js`** but there is **no `server.js` in `Front-end/web`** → Procfile and railway.toml disagree; relies on Dockerfile to define the real start. Open question (§7).
- **Frontend → backend:** `axios`; internal Next.js API routes also present under `src/app/api/`.

---

## 5. Current hosting reality (inferred)

- **Backend → Railway**, Docker build, start `node server.js`, health `/health`, restart-on-failure (max 10).
- **Frontend → Railway**, Docker build, health `/api/health`.
- **CI/CD → GitHub Actions**, 4 workflows in `.github/workflows/`:
  - `ci-frontend.yml` — lint → test → build, on any branch touching `Front-end/web/**`.
  - `ci.yml` — backend jest + 60% coverage floor, on any branch touching `Back-end/server/**`.
  - `ci-tests.yml` — backend tests on Node 20.x + 22.x matrix. ⚠️ **References `Autobacs/Back-end/server/...` (a path that does not exist in this repo)** → this workflow is almost certainly broken / misconfigured. Also overlaps with `ci.yml` (duplicate backend test runners).
  - `deploy.yml` — test-gated Railway deploy, **`on: push: branches: [main]` only**. Needs GH secrets `RAILWAY_TOKEN`, `RAILWAY_BACKEND_SERVICE_NAME`, `RAILWAY_FRONTEND_SERVICE_NAME`.
- **Branches:** only **`main`** exists locally and on origin. **No `develop` branch** despite the two-environment goal. Remote: `github.com/autobacsindia/EcommerceAutobacs`.
- **WordPress/Woo:** retired as a live target but `@woocommerce/woocommerce-rest-api` + import services remain (migration source). Coupling concentrated in: `services/{brandProductImport,productImport,migrationOrchestration,categoryImport}Service.js`, `controllers/product{Import,Admin}Controller.js`, `routes/{products,index}.js`.

### Git hygiene red flags surfaced during inventory (detailed in 10-git.md)
- **`node_modules/` is tracked in git — 9,099 files.** The session-start `git status` churn (`T`/`D` on `.bin/*`) is filemode/line-ending noise on these tracked vendor files.
- **`.gitignore` is UTF-16LE encoded** (bytes show BOM + space-separated chars). Git cannot parse UTF-16 ignore patterns → ignore rules are effectively inert, which is consistent with `node_modules/` having been committed despite a `node_modules/` line being "present."
- **`.env` not tracked** (good — only `.env.example` is tracked). `.env` exists on disk locally. Per prior audit memory, `.env` and a 200MB `mongodb-data/` dir were **purged from history** via `git filter-repo` (two history rewrites — collaborators must re-clone).

---

## 6. Size metrics

- **Total source LOC** (`.js/.ts/.tsx/.mjs/.cjs`, excluding `node_modules`, `.next`, `coverage`, test artifacts): **~157,515 LOC across ~950 files.**
- **Source files by type:** `js` 539 · `tsx` 313 · `ts` 90 · `mjs` 5 · `cjs` 3 · `py` 1.
- **Markdown files: 147 total** — 42 at repo root, 48 in `Back-end/server`, 29 in `Front-end/web`, rest scattered. **Severe doc sprawl** (e.g. ~15 separate `GUEST_CHECKOUT_*.md`, many `*_FIX.md` post-mortems). Full keep/merge/delete plan → `99-docs.md`.
- **TODO/FIXME/HACK/XXX:** ~10 source files contain markers (low — but the project leans on `*_FIX.md` docs instead of inline markers).
- **Largest 20 source files:**

| LOC | File |
|----:|------|
| 2400 | `Back-end/server/updated-category-import.js` (one-off import script) |
| 2023 | `Back-end/server/import-autobacs-categories.js` (one-off) |
| 1547 | `Front-end/web/src/app/admin/products/edit/[id]/page.tsx` |
| 1256 | `Back-end/server/routes/auth.js` |
|  945 | `Back-end/server/app.js` |
|  928 | `Back-end/server/services/elasticsearchService.js` |
|  881 | `Back-end/server/controllers/orderController.js` |
|  817 | `Front-end/web/src/app/model/[slug]/page/[page]/page.tsx` |
|  796 | `Front-end/web/src/app/products/[slug]/ClientPage.tsx` |
|  784 | `Front-end/web/src/app/admin/products/create/page.tsx` |
|  760 | `Front-end/web/src/app/model/[slug]/ClientPage.tsx` |
|  744 | `Front-end/web/src/app/admin/media/page.tsx` |
|  720 | `Back-end/server/services/searchService.js` |
|  714 | `Front-end/web/src/app/checkout/page.tsx` |
|  679 | `Back-end/server/test-order-management.js` |
|  670 | `Back-end/server/services/orderNotificationService.js` |
|  659 | `Front-end/web/src/app/consultation/page.tsx` |
|  633 | `Front-end/web/src/services/locationService.ts` |
|  630 | `Back-end/server/services/sessionStore.js` |
|  625 | `Front-end/web/src/components/orders/ReturnRequestModal.tsx` |

- **Backend code organization** (real source, excluding root scripts): `routes/` 34 files, `services/` 37, `models/` 26, `middleware/` **55** (unusually high — investigate in 20-architecture.md), `controllers/` 11, `utils/` 17, `repositories/` 7, `config/` 5, `queue/` 5, `validators/` **1**.
- **Backend root pollution:** the `Back-end/server/` root directory holds **hundreds of loose operational scripts** (`check-*.js`, `import-*.js`, `cleanup-*.js`, `test-*.js`, `seed-*.js`, `debug-*.js`, `verify-*.js`, plus `.bat/.ps1/.cmd`, `.log`, `.txt`, `.json` data dumps, `categories-list.txt`, `complete-wp-data.json`, etc.). These dwarf the structured `controllers/services/models` dirs and are a primary maintainability concern.

### Frontend structure
- App-router with ~40 route segments under `src/app/` (incl. `admin/`, `api/`, `auth`, `checkout`, `products`, `model`, `vehicles`, `orders`, `debug`, `integration-tests`).
- `src/components/` organized by domain (checkout, products, orders, vehicles, reviews, ui, skeletons, …); plus `context/`, `hooks/`, `lib/{hooks,http,services,utils}`, `providers/`, `services/`, `types/`, `utils/`, `styles/`.
- Two overlapping integration-test locations: `src/integration-tests/` and `src/app/integration-tests/` and `src/tests/`.

---

## 7. Open questions (carry into later phases / ask the human)

1. **DB direction:** backend is MongoDB/Mongoose. The prompt's `adr-002` assumes Prisma+Neon (Postgres). Is a Mongo→Postgres paradigm migration actually desired, or should the ADR evaluate "stay on Mongo (Atlas) vs. move to Postgres"? This is the single biggest scope question.
2. **Frontend host:** apps are currently configured for **Railway** (both have `railway.toml` + Dockerfile). The prompt's `adr-001` evaluates **Vercel**. Is the intent to move FE to Vercel, or is Railway-for-both the current chosen path?
3. **FE start command mismatch:** `railway.toml` says `node server.js` but no `server.js` exists in `Front-end/web` (Procfile says `npm start`). Which is authoritative — does the Dockerfile define the real start? Risk of broken deploy if railway.toml wins.
4. **CI duplication & broken path:** `ci.yml` and `ci-tests.yml` both run backend tests; `ci-tests.yml` points at a non-existent `Autobacs/` path. Is `ci-tests.yml` dead and safe to retire?
5. **`develop` branch:** the two-environment goal needs a `develop` branch + environment mapping. None exists yet. Confirm desired branch/promotion model.
6. **`frontend/` (lowercase) and `Back-end/coverage/`:** confirm these are disposable (stray test HTML / committed coverage) before any cleanup wave.
7. **Build system of record:** Dockerfile vs nixpacks.toml both present but railway.toml selects Dockerfile. Confirm nixpacks files are dead.

---

## 8. Cross-references
- Git/secret-scan detail → `10-git.md`
- 55-file middleware dir, god scripts, layering → `20-architecture.md`
- MongoDB schema & WP data shape → `50-database.md` (re-scope per Q1)
- Railway/CI/env-parity → `60-infra.md`
- 147 markdown files keep/merge/delete → `99-docs.md`

_Prior stabilization context (from audit memory): `.env` and `mongodb-data/` already purged from history; JWT secret rotated; multiple credentials still pending manual rotation by the owner; COD has no UI selector. These feed 70-security.md and the roadmap._
