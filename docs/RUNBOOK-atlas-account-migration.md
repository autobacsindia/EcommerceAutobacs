# RUNBOOK — Migrate MongoDB to a new Atlas account

Moving the production database from one MongoDB Atlas account/organization to a
new one, so the old account can be closed and its card never charged again.

**Why this is easy right now:** the database is **32 MB** (47 collections,
~100k documents, 250 indexes). Before 2026-08-14 it was 544 MB with 3.1M junk
telemetry rows — see [the cost remediation](#background). At this size the actual
data move takes well under a minute, so the risk is entirely in *configuration*,
not in the copy.

**Scope:** MongoDB only. Elasticsearch, Redis/Upstash, Cloudinary, Postmark,
Razorpay, Railway and Vercel are separate accounts with separate billing. If
those also sit on the old account, each needs its own plan. **Do not move
Razorpay casually — it is the money path.**

---

## Target configuration (match this exactly)

Read from the live cluster on 2026-08-14. Getting the region wrong is the one
mistake that silently costs performance — Atlas was deliberately moved
Mumbai → Singapore, which took query latency 565 ms → 185 ms.

| Setting | Value | Why |
|---|---|---|
| Tier | **M10** | 2 GB RAM, 2 vCPU, ~1500 connections. Entry dedicated tier. |
| Provider / Region | **AWS / Singapore (`ap-southeast-1`)** | Must match. Backend runs in Singapore. |
| MongoDB version | **8.0** | Source is 8.0.29. |
| Storage | **10 GB** | Actual usage is 32 MB. 10 GB is the M10 default. |
| Cloud Backup | **ON** | $0.14/GB-month. Trivial at this size. |
| Continuous Backup | **ON** | Point-in-time restore, ~1 min RPO instead of 6 hours. |
| Compute auto-scale | **ON, min M10 / max M20** | Absorbs a campaign spike instead of throttling. |
| Storage auto-scale | ON | Harmless. |
| **Termination Protection** | **ON** | It is currently OFF on prod. Turn it on. |
| Database name | **`autobacs`** | The URI path must end `/autobacs`. |

### Why M10 and not Flex

Measured on the live cluster: **40.66 ops/sec** average, **133 connections**.
Flex caps at ~500 ops/sec and ~500 connections.

- The 40/s is a 17-hour average *including overnight*; peaks are several times it,
  and festive campaigns / WooCommerce bulk sync / product reindex all spike hard.
  Flex **throttles with errors** at its ceiling — on checkout that is a failed
  order, not a slow page.
- `maxPoolSize` is 50 **per app instance** (`config/db.js`). Two or three Railway
  instances plus a local script crowds Flex's connection ceiling, and pool
  exhaustion presents as a hung site.
- Flex has no Performance Advisor and no compute auto-scaling — the two tools
  that diagnosed the 2026-08 cost problem.

M10 (~$66/mo) was always the correct size; the M20 bill was caused by the
telemetry bug, now fixed. The real choice is $66 right-sized vs ~$8–30
under-sized with a hard ceiling. Flex → M10 upgrade is possible later, but doing
this migration twice is more risk than doing it once.

---

## Phase 0 — Before you touch anything

- [ ] **Pick a quiet window.** There is a short read-only/write-loss window at
      cutover (Phase 4). Late night IST is best.
- [ ] **Capture the baseline manifest** from the OLD cluster. This is what proves
      afterwards that nothing was lost:
      ```bash
      cd Back-end/server
      node scripts/db-migration-manifest.js --save
      ```
      Expected: `47 collections, ~100k documents, 250 indexes`.
      Writes `db-migration-manifest.json` (gitignored). **Keep this file.**
- [ ] **Record the old connection string** somewhere safe — it is your rollback.
- [ ] Confirm tooling:
      ```bash
      mongodump --version    # needs mongodb-database-tools
      mongosh --version
      ```
      Install with `brew install mongodb/brew/mongodb-database-tools`.

---

## Phase 1 — Create the new account and cluster

- [ ] Sign up at **cloud.mongodb.com** with account B's email. Use a real billing
      email you monitor — invoices and scale-up alerts go there.
- [ ] Create an Organization (e.g. `Autobacs India`) and a Project (e.g. `production`).
- [ ] **Create the cluster** using the table above. Double-check **region** and
      **tier** before clicking create; changing region later means doing this
      migration again.
- [ ] Cluster → **Configuration → Additional Settings** → turn **Termination
      Protection ON**.
- [ ] **Set a billing alert now, before anything else.** Organization → Billing →
      *Set up billing alerts*. Threshold around **$80/month**. The 2026-08 M20
      surprise happened because auto-scaling had nobody watching it.

## Phase 2 — Access setup (this does NOT migrate)

Database users and the IP access list are per-cluster and are **not** copied by
`mongorestore`. Recreate them or the app cannot connect.

- [ ] **Database user for the app.** Security → Database Access → Add New
      Database User, password auth. Autogenerate the password and copy it.
      Role: **`readWrite` on the `autobacs` database only** — *not*
      `readWriteAnyDatabase`. The old app user had `readWriteAnyDatabase@admin`,
      which can drop any database in the cluster. Tighten it here.
- [ ] **Temporary migration user** with `readWriteAnyDatabase` (needed by
      `mongorestore` to write indexes). **Delete it after Phase 3.**
- [ ] **IP access list.** Security → Network Access. Add:
      - your current laptop IP (for the restore) — get it with `curl -4 ifconfig.me`.
        ⚠️ This is a **dynamic residential IP and it changes** — it moved from
        `49.37.232.42` to `49.37.235.214` within a single day. If a dump or restore
        suddenly times out with a server-selection error, re-check it here first;
        that is the usual cause, not a broken cluster.
      - whatever the backend needs. Railway egress IPs rotate, so this is usually
        `0.0.0.0/0` in practice. If so, that is exactly why the database user must
        be least-privilege.
- [ ] Verify you can reach it before dumping anything:
      ```bash
      mongosh "mongodb+srv://<user>:<pw>@<new-cluster>/autobacs" --eval 'db.runCommand({ping:1})'
      ```

## Phase 3 — Copy the data (rehearsal, with the app still live)

Do this once as a **rehearsal** while the old cluster is still serving traffic.
It costs nothing and surfaces problems early. You will repeat it at cutover.

- [ ] Dump:
      ```bash
      cd /tmp && rm -rf atlas-dump && \
      mongodump --uri="<OLD_URI>" --out=atlas-dump
      ```
- [ ] Restore:
      ```bash
      mongorestore --uri="<NEW_URI>" --dir=atlas-dump/autobacs \
        --nsInclude='autobacs.*' --drop
      ```
      `--drop` makes it idempotent, so a re-run is safe.
      ⚠️ Watch the output for index errors. Some legacy index specs in this repo
      were historically unbuildable (see [Background](#background)); the manifest
      check below is what catches a silent miss.
- [ ] **Prove parity:**
      ```bash
      cd Back-end/server
      TARGET_MONGODB_URI="<NEW_URI>" node scripts/db-migration-manifest.js --compare
      ```
      Must print **`✓ PARITY CONFIRMED`**. `COUNT` notes on `carts`,
      `rate_limit_events` and `sessions` are expected during a rehearsal because
      the old cluster is still taking writes. **Any `MISSING INDEX` or
      `INDEX DIFFERS` line is a stop sign.**
- [ ] Cross-check the schema view too:
      ```bash
      MONGODB_URI="<NEW_URI>" node scripts/audit-index-drift.js
      ```
- [ ] **Delete the temporary migration user.**

## Phase 4 — Cutover (the only step with downtime)

- [ ] Announce/choose the window. Expect **~5–10 minutes**.
- [ ] **Stop writes.** Simplest safe option: scale the Railway backend to 0
      replicas, or enable a maintenance page. Do not skip this — a write that
      lands on the old cluster after the final dump is silently lost.
- [ ] Re-run the **final** dump + restore (Phase 3 commands). At 32 MB this is
      seconds.
- [ ] Re-run the parity check. This time it must be clean with **no COUNT
      differences** — nothing is writing.
- [ ] **Flip the environment variable** in the Railway dashboard:
      `MONGO_URI` → the new cluster URI, ending `/autobacs`.
      ⚠️ The variable the server reads is **`MONGO_URI`**, not `MONGODB_URI`.
      `config/db.js` reads `MONGO_URI`; the scripts accept either. Setting only
      `MONGODB_URI` will fail to connect. This is a known footgun — see
      `docs/ENVIRONMENTS.md`.
      There is **no code change** — nothing hardcodes the host.
- [ ] Bring the backend back up. Watch the logs for
      `✓ MongoDB connected successfully`.

## Phase 5 — Verify production

- [ ] Backend health endpoint responds.
- [ ] Storefront loads; a product page renders (proves catalogue reads).
- [ ] **Log in** (proves `users` + indexes).
- [ ] **Add to cart** (proves the cart write path and the new `sessionId_1` unique
      partial index).
- [ ] **Open an existing order in admin** (proves order history survived).
- [ ] Place one **real low-value test order end-to-end** including payment. This
      is the only way to prove the money path. Refund it afterwards.
- [ ] Admin → rate-limit dashboard renders.
- [ ] Flush Redis so nothing serves stale reads:
      ```bash
      cd Back-end/server && railway run npm run flush-cache
      ```
      ⚠️ Run it via `railway run` — the local `REDIS_URL` is the **queue** Redis,
      not the cache, so running it locally deletes 0 keys and looks like success.
- [ ] Elasticsearch is a **separate** cluster and is unaffected — but confirm
      search still works, and reindex if anything looks stale:
      `npm run reindex-products`.

## Phase 6 — Decommission the old account

**Wait at least 7 days.** Do not rush this; it is your only rollback.

- [ ] Old cluster → **Pause** (not delete). Paused clusters still cost a little
      but restore instantly.
- [ ] After a week of clean production, take a final snapshot / download an
      archive if you want a cold copy.
- [ ] Delete the old cluster, then the old project, then the old organization.
- [ ] **Settle the final invoice.** Billing runs to the 1st of the month, so
      there will be a closing charge covering the days before you moved. Atlas
      will not let you abandon an unpaid balance, and an unpaid one eventually
      suspends resources.
- [ ] Confirm the old card shows no further Atlas charges the following month.

---

## Rollback

Before Phase 6, rollback is: set `MONGO_URI` in Railway back to the old cluster
URI and restart. That is the entire procedure — which is why the old cluster
stays paused-not-deleted, and why you kept the old URI.

Any writes that landed on the new cluster after cutover would be lost by a
rollback, so decide quickly if something is wrong.

---

## Background

Context a future reader will want:

- On 2026-08-14 the database was reduced 544 MB → 32 MB by stopping per-request
  rate-limit telemetry (`rate_limit_events` was 95% of the database and ~100% of
  insert volume, and had driven Atlas compute auto-scaling M10 → M20, +$102/mo).
- Two TTL indexes on `carts.recentChanges` were deleting whole cart documents and
  were removed. Prod indexes had drifted from the schemas for months because
  `autoIndex` is off in production and nothing reconciled them.
- Several schema index declarations were **silently unbuildable** (`$ne` is
  rejected inside a `partialFilterExpression`; duplicate index names with
  conflicting options). Verify indexes after any restore rather than assuming —
  `scripts/audit-index-drift.js` and `scripts/db-migration-manifest.js` exist for
  exactly this.
- The cluster is expected to auto-scale back M20 → M10 within ~24h of 2026-08-14.
  If it has not, check Organization → Activity Feed before assuming M10 pricing.
