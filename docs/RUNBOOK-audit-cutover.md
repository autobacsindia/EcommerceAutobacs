# RUNBOOK — Audit Remediation Cutover (2026-07)

Ops checklist to take the 2026-07 audit remediation live. Full findings + fix
backlog: [docs/audit/09-CONSOLIDATED-2026-07.md](audit/09-CONSOLIDATED-2026-07.md).

> **Deploy model:** pushing to `main` **auto-deploys** (Railway backend, Vercel
> frontend). So **do the prerequisites below BEFORE pushing** — a push ships
> immediately. The remediation commits are currently local-only (not pushed).

---

## ✅ Already done (code, committed locally on `main` — not pushed)

- **Batch 1–2** (`2df8072e`): PAY-1 (webhook no longer kills shared Redis), SEC-1/2/3,
  BE-3/4, DB-1 (email lowercase), FE-2, DOCS-1; dep bumps (mongoose/express/multer/next);
  `security.yml` (gitleaks + npm-audit CI).
- **Batch 3** (`d4f26281`): PAY-2 (refunds reverse LTV), FE-1 (revalidate auth),
  BE-2 (atomic invoice), BE-1 (Sentry on ES/cache failures).
- **Batch 4** (`78062f74`): DB-2 (autoIndex off in prod), DEP-1c (cloudinary v2 +
  removed dead `multer-storage-cloudinary`).
- **P3s** (`d553e780`): FE-3 (server-side blog sanitize), DEP-2 (protobufjs override → 0 criticals).
- **FE-1 follow-up** (`8551c9bd`): revalidate routes allow same-origin admin calls
  (so `REVALIDATE_SECRET` is now optional).

## ✅ Data migrations already RUN against prod (2026-07-09)

| Script | Result |
|---|---|
| `npm run backfill-normalize-emails` | **No-op** — all 2,349 emails already lowercase/clean. `--apply` not needed. |
| `npm run backfill-crm-leads -- --apply` | **APPLIED** — CRM populated: 306 customers' LTV, 386 paid orders stamped `purchaseCounted`, 99 leads. |
| `npm run reconcile-user-ltv` (dry-run) | **0 drift** vs the backfill — cross-validated; no correction needed. |

---

## ⏳ Ops actions BEFORE pushing to deploy (dashboards — not code)

- [ ] **`RESET_TOKEN_SECRET` in Railway (backend)** — REQUIRED. Backend refuses to
      boot in prod without it. Generate: `openssl rand -hex 32`. **No trailing space.**
      Set once and don't rotate casually (invalidates outstanding reset/verify links).
      _(Reported set on 2026-07-09.)_
- [ ] **`REVALIDATE_SECRET` in Vercel (frontend)** — OPTIONAL. Admin homepage refresh
      works without it (same-origin allowed). Only set it to permit external/cron
      triggers. Never on Railway. Generate: `openssl rand -hex 32`.
- [ ] **Branch protection on `main`** (GitHub → Settings → Branches): require PRs,
      block direct pushes, and require these checks — `Backend CI`, `Frontend CI`,
      and the 3 `security.yml` jobs (`secrets`, `audit-backend`, `audit-frontend`).
      This is the deploy gate the whole CI setup depends on (INFRA-1).
- [ ] **Provision a dev/staging MongoDB + dev `.env`** — local `.env` currently points
      `MONGO_URI` at the PROD cluster. Required before the testing phase so tests don't
      mutate prod data. (Razorpay is already test-mode, so payments are safe.)

## ⏳ Post-deploy / operational

- [ ] Flush Redis `route:*` + `public:*` after deploy (data/cache-shape changes).
- [ ] Consider scheduling `reconcile-user-ltv` nightly (LTV self-heal backstop).
- [ ] Give a blog article a visual QA pass (FE-3 moved sanitize server-side; verify
      images/formatting render).

---

## ⏳ Remaining CODE work (deferred — larger, lower urgency)

- **OBS-1 (P2)** — structured logging (pino + redaction) across ~97 `console.*` files.
- **INFRA-1 de-flake** — 21 memory-server suites are flaky when run together
  (`mongodb-memory-server` contention); needs a shared-instance refactor + iterative
  full-suite verification (best after the dev/staging DB exists).
- **Accepted low-reachability transitive highs** — `fast-xml-parser`/`form-data`/
  `minimatch`/`path-to-regexp`/`undici` (deep aws-sdk/express/twilio deps). Optional
  deps pass; CI gate stays at `critical` until addressed, then raise to `high`.
- **Minor:** duplicate `email` index warning in `models/User.js` (`unique:true` field
  + explicit `.index()`); Redis degraded-mode vs hard-exit at boot.

## Then: TESTING phase (the original goal)

Once the dev/staging DB exists: unit (pricing/coupon/karma), integration (Razorpay
webhook incl. PAY-1 regression, order state machine, refund→LTV), execute the
never-run guest-checkout e2e, and a manual smoke on staging.

---

_Generated 2026-07-09 during the audit remediation session._
