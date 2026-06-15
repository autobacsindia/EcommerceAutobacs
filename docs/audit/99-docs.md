# 99 — Documentation & Markdown Cleanup

_Phase 1. **147 markdown files** (42 repo root, 48 `Back-end/server`, 29 `Front-end/web`, rest scattered). Severe sprawl: most are AI-generated fix post-mortems and one-off guides. **No deletions performed — plan only.**_

## The problem
The repo uses markdown files as a substitute for issue tracking and changelogs. Examples of the pattern:
- ~15 `GUEST_CHECKOUT_*.md` / `GUEST_CART_*.md` (overlapping accounts of the same feature).
- Dozens of `*_FIX.md` / `*_FIX_SUMMARY.md` post-mortems (`CART_404_ERROR_REAL_FIX.md`, `CHUNK_LOAD_ERROR_FIX.md`, `NEXTJS_*_HOOK_FIX_*.md`, …).
- Many overlapping import/category guides in `Back-end/server` (`IMPORT_SUMMARY.md`, `IMPORT_SUMMARY_FIXED.md`, `FINAL_IMPORT_SUMMARY.md`, `INCREMENTAL_IMPORT_*`, several `*CATEGORY*` guides).
- Multiple Railway cache-clear / redeploy guides (`URGENT_MANUAL_CACHE_CLEAR.md`, `STEP_BY_STEP_RAILWAY_CACHE_CLEAR.md`, `ALTERNATIVE_CACHE_CLEAR_METHODS.md`, …).

## Status plan (by category — `keep` / `merge` / `rewrite` / `delete`)

| Category (examples) | Count (approx) | Status | Target |
|---|---:|---|---|
| `*_FIX.md` / `*_FIX_SUMMARY.md` post-mortems | ~30 | **delete** | history is in git; not docs |
| `GUEST_CHECKOUT_*` / `GUEST_CART_*` | ~15 | **merge** | one `/docs/features/guest-checkout.md` |
| Import/category guides (BE) | ~20 | **merge** | one `/docs/migration/wordpress-import.md` |
| Railway cache-clear / redeploy guides | ~8 | **merge** → mostly **delete** | `/docs/runbook.md` (deploy section) |
| `*_TRIGGER*.txt` / `cache-bust` / `REBUILD_TRIGGER.txt` | several | **delete** | not docs (see tooling T4) |
| API docs (`API_DOCUMENTATION.md`, `*_API_DOCS.md`) | ~8 | **rewrite/merge** | `/docs/api/` (or OpenAPI) |
| Security docs (`CRITICAL_SECURITY_ACTION_REQUIRED.md`, `SECRETS_ROTATION_GUIDE.md`, `SECURITY_STATUS_REPORT.md`) | ~4 | **merge** | `/docs/security.md` (+ add Twilio/ES rotation, see S1) |
| Setup/integration guides (Google Maps, Razorpay, Mongo, Elasticsearch, Facebook) | ~15 | **merge** | `/docs/integrations/*.md` |
| App `README.md` (root, BE, FE) | 3 | **keep/rewrite** | canonical READMEs |
| Roadmap/checklist (`AUTOBACS_MASTER_ROADMAP.md`, `AUTOBACS_ROADMAP_CHECKLIST.md`, `AUDIT_IMPLEMENTATION_SUMMARY.md`) | 3 | **keep** | `/docs/roadmap.md` |

## Proposed target docs structure
```
README.md                      ← what/why, quickstart, links
CONTRIBUTING.md                ← branch flow (develop→main), commit, PR, CI
/docs/
  architecture.md              ← system overview, FE/BE/DB/Redis/ES
  runbook.md                   ← deploy, rollback, cache-clear, incident
  security.md                  ← headers, auth, secret rotation
  api/                         ← endpoint reference (or OpenAPI spec)
  integrations/                ← razorpay, cloudinary, sendgrid, twilio, maps, es
  migration/wordpress-import.md
  features/                    ← guest-checkout, tracking, etc.
  roadmap.md
  audit/                       ← this audit (keep)
```

## Action
- **Do not delete yet.** After human sign-off (Wave 1), execute the merge/delete map above. Net target: ~147 files → ~15–20 curated docs.
- Generate a precise per-file CSV (path → status → target) at execution time so nothing is lost silently.
