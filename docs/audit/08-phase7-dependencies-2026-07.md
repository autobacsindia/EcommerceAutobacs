# Phase 7 — Dependencies & Tooling (2026-07)

_Auditor: Claude Code · Date: 2026-07-09 · Read-only, findings only._

**Verdict: the raw counts overstate the risk.** Backend "53 vulns (1 crit, 15 high)" / frontend "27 (2 high)" → after **reachability triage**, there is **no production-reachable critical**, and ~6 genuinely reachable highs, all with fixes. Most of the scary-rated items are **dev/build-only tooling**.

## Reachability triage (the number that matters)

| Bucket | Items | Prod risk | Action |
|---|---|---|---|
| **Dev-only (not runtime)** | `protobufjs` (**CRITICAL**), `@grpc/grpc-js`, `socket.io-parser` — all transitive via **`artillery`** (load-test devDep); grep confirms none imported in app code | **None** | Update/remove artillery; ignore for prod risk |
| **Production-reachable direct** | `mongoose`, `express`, `multer`, `cloudinary`, `multer-storage-cloudinary` (BE); `next` (FE) | **Real** | Upgrade (see DEP-1) |
| **Transitive, low reachability** | `lodash` (`_.template` **not called** — grep empty), `form-data`, `fast-xml-parser`, `undici`, `minimatch`, `picomatch`, `path-to-regexp`, `ws`, `serialize-javascript` (build-time) | Low | Resolved by `npm audit fix` |

## Findings

| ID | Sev | Package (current) | Vuln | Fix path |
|----|-----|-------------------|------|----------|
| **DEP-1a** | P2 | `mongoose` 8.19.4 | Improper `$nor` sanitization → **NoSQL injection** (mitigated in-app by `express-mongo-sanitize` + `querySanitizer`, but defense-in-depth) | `npm audit fix` (within-8.x patch, **non-breaking**) |
| **DEP-1b** | P2 | `next` 15.3.9 | **Cache-key confusion, Image Optimization API** — relevant given the `next.config` WP image allowlist | Bump to latest 15.x patch (**non-breaking**) |
| **DEP-1c** | P2 | `cloudinary` 1.41.3 (+ `multer-storage-cloudinary`) | Arbitrary **argument injection** via `&`-containing params | **Breaking**: `cloudinary@2.10.0`. Separate PR — review v1→v2 uploader API migration + test image-upload flow |
| **DEP-1d** | P3 | `express` 4.21.2, `multer` 2.1.1 | body-parser issue; multer DoS via deeply nested field names (upload routes are **admin-only** → limited exposure) | `npm audit fix` (patch, non-breaking) |
| DEP-2 | P3 | `artillery` (devDep) tree | Source of the CRITICAL `protobufjs` ACE + `@grpc`/`socket.io` highs — **not shipped/imported** | Update artillery, or move it to an isolated tooling package / remove if unused → drops the critical + 3 highs from the tree |
| DEP-3 | P2 | — | (dup of CI-1) No `npm audit`/`gitleaks` gate in CI → this debt silently re-accumulates | Add `npm audit --audit-level=high` + `gitleaks` jobs |

## Recommended remediation order (low-risk first)
1. **`npm audit fix`** (non-force) on both apps → clears mongoose, express, multer, next-adjacent transitives, protobufjs (via artillery bump). Dry-run: "added 37, removed 244, changed 189" — large but non-breaking. **Run curated CI suite + smoke after.**
2. **Frontend `next`** patch bump (image-opt CVE) → verify `next/image` + WP allowlist still render.
3. **`cloudinary` v1→v2** (breaking) in its **own PR** — migrate uploader calls (`uploadMiddleware.js`, `productImageController.js`), test upload + magic-byte path end-to-end.
4. **Isolate/remove `artillery`** → eliminates the "critical" from the report permanently.
5. **Add CI audit gate** (DEP-3/CI-1) so it can't regress.

## Notes
- The 36 backend + 25 frontend **moderate** vulns are overwhelmingly transitive dev/build tooling (webpack, jest, eslint chains); `npm audit fix` sweeps most. Not itemized — low priority, batch-fix.
- `--force` is **not** required except for cloudinary; avoid blanket `npm audit fix --force` (it would pull other breaking majors untested).

## Exit criteria
- [x] Critical + high vulns triaged by **reachability** (BE + FE).
- [x] Dev-only vs runtime-reachable separated; upgrade paths (breaking vs patch) identified.
- [ ] DEP-1a/b (P2) + DEP-1c (breaking, P2) → fix backlog; DEP-2/3 → tooling backlog.
