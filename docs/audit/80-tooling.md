# 80 — Dependencies & Tooling

_Phase 1._

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| T1 | P2 | No `.husky/`, no `lint-staged`, no pre-commit hooks | Lint/format not enforced locally → quality drift; CI is the only gate | Add husky + lint-staged (eslint --fix + format on staged files) |
| T2 | P2 | No Prettier config in either app | No formatting standard → inconsistent style, noisy diffs | Add Prettier + `format` script + CI check |
| T3 | P2 | FE `@sentry/nextjs ^10` vs `@sentry/node ^8` vs `@sentry/react ^8`; FE has both `@sentry/node` and `@sentry/nextjs` | Mixed/duplicate Sentry majors | Standardize on `@sentry/nextjs` 10.x |
| T4 | P2 | Backend version `1.0.4-cache-bust`, FE `0.1.5-complementary-products`; `BUILD_TRIGGER_*.txt`, `DEPLOY_TRIGGER_*.txt`, `REBUILD_TRIGGER.txt`, `cache-bust.js` | `package.json` version + dummy files abused as deploy cache-busters | Use real semver; bust Docker cache via build args (already done in FE Dockerfile) — delete trigger files |
| T5 | P3 | Backend `eslint.config.js` lints only `controllers/ routes/ services/` (`--max-warnings 0`) | Lint scope excludes `middleware/`, `models/`, `utils/`, root scripts | Widen lint scope or formally exclude scripts dir |
| T6 | P3 | `dotenv ^16` (BE) vs `^17` (FE) | Minor cross-app dep drift | Align shared dep versions where practical |

## Lockfiles
- Both apps have `package-lock.json` (npm). No workspace tooling — independent installs. Lockfiles present and committed (good).

## Linting / formatting
- ESLint 9 in both (`eslint.config.js`/`eslint.config.mjs`). FE uses `eslint-config-next`. Enforced in CI (`ci.yml`/`ci-frontend.yml`) but **not pre-commit** (T1) and **no formatter** (T2).

## TypeScript
- **Frontend:** TS `^5`, `tsconfig.json` with **`strict: true`** ✅. `next build` fails on TS errors (per `ci-frontend.yml`).
- **Backend:** **no TypeScript** (plain ESM JS). Largest single quality lever for the backend long-term; consider incremental `// @ts-check` + JSDoc or a gradual TS migration (roadmap Wave 1+).

## Abandoned / risk deps
- `cloudinary ^1.41` — v1 is legacy (v2 current); plan upgrade.
- `bcryptjs ^2.4` — fine but `bcrypt`/argon2 worth considering.
- `@woocommerce/woocommerce-rest-api` — remove after WP migration completes.
- Full outdated/vuln scan pending (`npm outdated` + `npm audit` in CI — see S2).
