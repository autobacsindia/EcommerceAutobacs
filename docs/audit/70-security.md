# 70 — Security

_Phase 1. Overall the app has a **stronger-than-typical** security posture (helmet/CSP, CSRF, rate limiting, sanitization). Main gaps are secret rotation, dependency scanning in CI, and a few hygiene items._

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| S1 | P0 | Prior memory: rotation outstanding | Multiple **prod credentials not yet rotated** after the `.env` history exposure: MONGO_URI/Atlas pw, Atlas API keys, SendGrid, Google Maps (2), Google OAuth, Facebook, Cloudinary, **Twilio**, **Elasticsearch** | **USER ACTION** — rotate all via dashboards now; Twilio + Elasticsearch were missing from `SECRETS_ROTATION_GUIDE.md` |
| S2 | P1 | `npm audit` could not run in audit env (no network) | Dependency vulnerability status unknown | Run `npm audit`/`osv-scanner` in CI on both apps; gate PRs on high/critical |
| S3 | P1 | No `gitleaks` in CI; `.env` was historically committed (purged) | No automated secret scanning | Add `gitleaks` to CI; verify history clean post-purge |
| S4 | P2 | `externalId`/`WORDPRESS_API_*` legacy refs; `.env.example` may list retired WP keys | Stale credentials/fields surface area | Remove retired WP env keys from `.env.example` and code |
| S5 | P2 | 611 `console.*` in backend src | Risk of logging PII/tokens/secrets in plaintext logs | Structured logger with redaction (see `95-observability.md`) |
| S6 | P2 | File uploads via `multer` + `multer-storage-cloudinary` (`uploadMiddleware.js`) | Confirm MIME/size/type validation + auth on upload routes | Verify upload constraints + admin-only guards |
| S7 | P3 | `securityHardening.js` + `securityHardeningFinal.js` + `securityMiddleware.js` | Duplicate security middleware → risk one is stale/bypassed | Consolidate (see architecture A3) |

## OWASP quick pass (evidence-based)
- **Injection (NoSQL):** mitigated — `express-mongo-sanitize` wired via `sanitizationMiddleware.js`; `sanitize-html` + `isomorphic-dompurify` present for HTML.
- **Broken auth:** JWT + bcrypt + Redis session store; rate-limited login. Verify token expiry/refresh in auth refactor (B2).
- **CSRF:** `csrfMiddleware.js` applied (correctly after webhook raw route).
- **Security headers:** `helmet()` + per-request CSP nonce (`cspNonce.js`).
- **Sensitive data exposure:** primary risk is the unrotated secrets (S1) + console logging (S5).
- **SSRF / deserialization:** WP import does outbound HTTP to Woo REST — validate/limit target URLs in import services; watch serialized WP meta (insecure-deserialization vector) during any further imports.
- **Rate limiting / DoS:** strong (express-rate-limit + Redis + body limits). Unbounded `.find()` queries (B1) are the residual DoS vector.
- **TLS/HTTPS:** terminated at Railway/Vercel edge; `trust proxy = 2` set.
- **Payments:** Razorpay webhook signature-verified with raw body — correct. Keep on `rzp_test_*` until UI revamp done (prior memory).

## Strengths
Helmet+CSP nonce, CORS allowlist, CSRF, mongo-sanitize, body-size limits, extensive rate limiting, signature-verified webhooks, prod env validation gate (`validate-production-env.js`), Sentry. This is not junior-grade security — it's the **operational hygiene** (rotation, scanning, dedupe) that lags.
