# 95 — Observability & Ops

_Phase 1._

| ID | Sev | Evidence | Issue | Suggested fix |
|----|-----|----------|-------|---------------|
| O1 | P1 | `grep console.* controllers/services/routes/middleware` = **611**; no `winston`/`pino`/`bunyan` | Logging is raw, unstructured `console.*` → not queryable, no levels, **PII/secret leakage risk** | Adopt `pino` (structured JSON + levels + redaction); replace console.* |
| O2 | P2 | Error tracking via `@sentry/node` + `sentryContext.js` (BE), `@sentry/nextjs` + LogRocket (FE) | Sentry present (good) but FE mixed SDK majors (T3); confirm release/sourcemap upload + env tagging | Standardize Sentry; verify sourcemaps + `develop`/`prod` env separation |
| O3 | P2 | Health: BE `/health` (+ redis health check), FE `/api/health` + `/api/warmup`; no external uptime monitor noted | Health endpoints exist but no documented uptime/alerting | Wire uptime monitor (Railway/UptimeRobot) + alert routing |
| O4 | P2 | `routes/rateLimitDashboard.js`, `routes/redisMonitor.js`, pool-health event logging in `server.js` | Custom metrics/dashboards exist but are bespoke (console-based), not a metrics backend | Export metrics (Prometheus/OpenTelemetry) or accept Sentry+logs; reduce bespoke dashboards (architecture A4) |
| O5 | P3 | `mongod*.log`, `debug_log*.txt`, `*.out`, `lint_output.txt`, `test_output.txt` committed | Log/output files tracked in repo | Gitignore + remove (now that `.gitignore` works) |

## Logging quality
- **Volume:** 611 `console.*` calls across backend src — high noise, no structured fields, no log levels, no sampling.
- **PII risk:** order/auth/notification flows log freely; needs redaction policy (emails, tokens, addresses, payment refs).
- **Retention:** relies on Railway log retention (limited); no central log store.

## Error tracking / APM
- Sentry on both tiers (incl. `@sentry/profiling-node` on backend) — solid foundation. LogRocket on FE for session replay.
- Action: confirm Sentry DSNs are env-scoped per environment, sourcemaps upload in CI/build, and PII scrubbing is on.

## Ops runbooks
- Many ad-hoc `*_FIX.md` / cache-clear / redeploy docs exist (see `99-docs.md`) but no single runbook. Consolidate into `/docs/runbook.md`.
