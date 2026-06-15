# ADR-001 — Frontend hosting: Next.js on Vercel vs. keep Railway

_Status: Proposed · Date: 2026-06-15 · Auditor: Claude Code_

## Context

The frontend (`Front-end/web`) is **Next.js 15.3.9 / React 19**, App Router, TypeScript, Tailwind v4, with `next-pwa`, Sentry, and `output: 'standalone'`. It is currently deployed on **Railway** via a hand-maintained multi-stage `Dockerfile` (config in `railway.json`: V2 runtime, single replica `us-west2`, healthcheck `/api/warmup`). The backend (Express + MongoDB) is a separate Railway service reached via `NEXT_PUBLIC_API_URL`.

The open question: move the frontend to **Vercel** (the first-party Next.js platform) or keep evolving it on Railway?

Relevant facts from Phase 0:
- App is genuinely Next-native (App Router, standalone output, ISR-capable). Not a thin SPA.
- Internal API routes exist under `src/app/api/*` (incl. `health`, `warmup`).
- Mixed Sentry major versions (10.x nextjs, 8.x node/react) — needs reconciling regardless of host.
- New `develop → main` branch flow just established; preview deploys would pair with it.
- WordPress is being retired; the UI is **not** coupled to WP at runtime (data comes from the Express API).

## Options

### A. Keep on Railway (status quo)
- **+** One platform for FE + BE; already working; full control of the container.
- **+** No vendor migration work right now.
- **−** Hand-maintained Dockerfile to keep current (Node bumps, standalone copy steps).
- **−** No native Next image optimization CDN, no edge, no on-demand ISR revalidation infra, no per-PR preview URLs without building it yourself.
- **−** You operate the CDN/caching story manually.

### B. Move to Vercel (recommended)
- **+** First-party Next.js 15 support — zero Dockerfile, framework-aware builds.
- **+** **Preview deployment per PR** — pairs directly with the new `develop`/`main` flow; reviewers test a live URL before merge.
- **+** Built-in image optimization + global CDN/edge, ISR + on-demand revalidation out of the box.
- **+** First-class Sentry + Next integration, env var management per environment (Preview/Prod).
- **−** Vendor split (FE Vercel, BE Railway) — two dashboards.
- **−** `src/app/api/*` routes become serverless functions: must avoid long-lived connections / heavy cold-start work; audit each route.
- **−** Cost watch at scale: image-optimization units + function invocations/duration can grow; Pro plan + usage.

## Trade-offs summary

| Dimension | Railway (keep) | Vercel (move) |
|---|---|---|
| Maintainability | Dockerfile upkeep | No build config to own ✅ |
| DX / PR previews | DIY | Native per-PR previews ✅ |
| Next features (ISR/img/edge) | manual/none | native ✅ |
| Cost at low traffic | low | low (Pro ~ modest) |
| Cost at high traffic | predictable container | usage-metered — monitor ✅/⚠️ |
| Lock-in | low (plain Docker) | medium (Vercel-specific features) |
| Migration effort | none | low–medium (env + API-route audit) |

## Recommendation

**Move the frontend to Vercel; keep the backend (Express + MongoDB) on Railway.** This is the conventional, low-friction split for a Next.js app with a separate API. The decisive factors are per-PR preview deployments (which make the new `develop → main` workflow actually useful) and eliminating Dockerfile maintenance, with native ISR/image/edge as a bonus. Keep the backend where it is — nothing about it benefits from Vercel.

Migration steps (for the roadmap, Wave 2): import repo to Vercel (root `Front-end/web`), map `NEXT_PUBLIC_*` env vars per Vercel environment, wire Preview→`develop` / Production→`main`, drop the FE `Dockerfile` + Railway FE service + `/api/warmup` healthcheck, audit `src/app/api/*` for serverless-safety, reconcile Sentry SDK versions, validate `next-pwa` on Vercel.

## Confidence: **High.**
What would raise it further: a quick traffic/bandwidth estimate to model Vercel usage cost at expected scale, and an inventory of `src/app/api/*` routes to confirm none need a persistent socket/connection.
