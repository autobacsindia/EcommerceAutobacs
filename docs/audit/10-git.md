# 10 — Repository & Git Hygiene

_Phase 1. Severity legend: P0/P1/P2/P3. Some items already remediated this session (marked ✅ FIXED)._

| ID | Sev | Evidence | Issue | Suggested fix (one line) |
|----|-----|----------|-------|--------------------------|
| G1 | P1 | `git branch -a` showed only `main` at session start | No `develop` branch despite two-env goal | ✅ FIXED — `develop` created from `main` and pushed this session |
| G2 | P1 | `.gitignore` bytes were UTF-16LE; `git ls-files \| grep node_modules` = 9099 | Root `.gitignore` was unparseable by git → all ignore rules inert → `node_modules/` (9099 files) committed | ✅ FIXED — `.gitignore` rewritten UTF-8; node_modules untracked (commit `3af702b0`) |
| G3 | P1 | Repo settings (no API access) | No branch protection on `main`/`develop` (no required PR/checks/no-force-push) | **USER ACTION** — enable in GitHub: require PR + green CI, block force-push to `main` |
| G4 | P2 | `git rev-list --objects --all` + cat-file: `Hero_Banner3.jpeg` 7.3MB, `products.json` 7.2MB, elastic `types.d.ts` 2.0MB, a vehicle PNG 1.2MB | Large binaries + vendored node_modules bloat `.git` history (persist even after untracking) | Optional history slim via `git filter-repo` (coordinate — rewrites history, forces re-clone); move large assets to Cloudinary/LFS |
| G5 | P2 | Prior audit memory | History already rewritten twice (`.env`, `mongodb-data/`) via filter-repo + force-push | Confirm all collaborators re-cloned; document the rewrite in README |
| G6 | P2 | No `gitleaks`/secret-scan in CI | Secret scanning is manual only | Add `gitleaks` to CI on PR; fail on findings |
| G7 | P3 | `git log -60`: 49/60 conventional; commit `bd511817` = "caveman" | Conventional-commit adoption ~82% but unenforced; some junk messages | Add commitlint (optional) or PR-title lint |

## Secret scan (history) — presence only, never values
- `.env` and `mongodb-data/` **already purged** from history (prior session, `git filter-repo`). `.env` currently untracked on disk (correct). `.env.example` tracked (correct — placeholder).
- **Recommend** a fresh `gitleaks detect` pass over current history in CI to confirm no other key patterns linger (Razorpay/SendGrid/Atlas/Twilio/Cloudinary/Google).

## Notes
- 695 total commits. `develop` = `main` + 2 (this session's fixes).
- Remote: `github.com/autobacsindia/EcommerceAutobacs`, single remote `origin`.
