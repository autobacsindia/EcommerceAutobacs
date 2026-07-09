# ADR-006 — CRM v2: Lead Lifecycle, Net LTV & Sales Reporting

_Status: Accepted · Date: 2026-07-08 · Author: Autobacs India + Claude Code_

## Context

The Sales CRM (see [Lead.js](../../../Back-end/server/models/Lead.js), [leadSyncService.js](../../../Back-end/server/services/leadSyncService.js), ADR for the original build lives in the `sales-crm-leads` work) is person-centric: **one `Lead` document per identity**, deduped by `identityKey` (`email:` or `phone:`), with a `sources[]` array and a single `status` (`new → contacted → qualified → won → lost`).

One field is doing two jobs. `Lead.status` conflates:
- **Is this person a customer?** — a *permanent* fact about the person.
- **Where are they in a sales cycle right now?** — a *temporary* fact about one workable opportunity.

Failure mode: a person converts (`status: won`), then returns later with a new signal (new consultation, new abandoned cart). `leadSyncService._upsertSource` appends the new source to the **same** doc but leaves `status: won`, so a hot returning prospect is **invisible in the active pipeline**. Symmetric problem for `lost`.

Secondary gaps: no lifetime-value figure ("total spent with us"), no managed sales-rep list / reporting, and identity stitching only matches on a single key (email *or* phone, not both).

## Decision

Separate the **permanent customer record** (on `User`) from the **temporary sales cycle** (on `Lead`). Do **not** introduce a separate Opportunity collection — keep one `Lead` per person and add cycle history. Rationale: 90% of the Opportunity-model benefit at a fraction of the surface area, and it fits the existing single-writer (`leadSyncService`) design.

### D1 — Cycle model & reopen-with-history
- Add `cycleStartedAt` and `cycles[]` (closed-cycle snapshots: sources, winning rep, `convertedOrder`, `convertedAt`, close reason) to `Lead`.
- When a **genuinely new source ref** arrives on a person whose status is **terminal** (`won`/`lost`): push the closed cycle into `cycles[]`, reset `status: new`, release to pool (`assignedTo: null`), clear `nextFollowUpAt`, set a fresh `cycleStartedAt`, start a new `sources[]` for this cycle. History and attribution preserved.
- `hasPurchased` / `linkedUser` are **untouched** across reopens — they are permanent.
- Reopen logic lives in **exactly one place**: `leadSyncService._upsertSource` (the sole writer). Guarded so the **paid-order sync** (`_markConvertedByIdentity`) and **dormant-sweep re-runs** can never trigger a reopen.

### D2 — Net Lifetime Value
- Add `totalSpentPaise` and `lastOrderAt` to `User`, incremented at the payment-success hook next to `paidOrderCount` (paise math, per `pricingService`).
- **LTV is NET of refunds.**
- ⚠️ **PENDING seam — refund/return not yet wired.** When refunds/returns are built, the refund-success path **must subtract** from `User.totalSpentPaise`, and a **periodic reconcile job** must recompute `totalSpentPaise` from `paid − refunded` orders to correct drift. The field is added now so this slots in cleanly later. **This must not be forgotten when implementing refunds/returns.**

### D3 — Conversion attribution = owner-at-close
- A conversion is credited to `assignedTo` at the moment `status → won`. Reassignments before close do not affect the leaderboard. Single documented rule to avoid sales-floor disputes.

### D4 — Sales reps (full-admin for now)
- Add `isSalesRep` (bool) + optional `salesTarget` to `User`. This only populates the assign dropdown and reporting — **no route gating yet**; reps remain full admins.
- All "assignable / shows in reports" checks go behind a single `isSalesRep(user)` helper (never scattered `role === 'admin'`), so the later `sales`/`ops` role split is a one-helper + route-guard change.

### D5 — Filters, badges, reporting
- Badges (derived, not stored): **New Prospect**, **Customer**, **Returning** (customer + active cycle after last purchase), **Reopened**, **VIP** (LTV over threshold), plus the existing source badge.
- Filters/segments: assigned-rep, lost-reason, and preset chips (Returning / Reopened / High-value / Never-contacted / Won-this-month).
- `GET /leads/reports?from&to&repId` — Mongo aggregation grouped by rep: assigned, first-contacted, qualified, won, lost, conversion rate, time-to-first-contact, time-to-close, revenue influenced. Live aggregation is sufficient at current volume.

### D6 — Backfills
- `cycleStartedAt = createdAt`; compute `totalSpentPaise` once from paid orders; reconcile `linkedUser` by email **and** phone.
- Every backfill ships with a **dry-run mode** and is **idempotent** (will be run more than once).

## Phasing
1. **Customer 360** — `totalSpentPaise`/`lastOrderAt` + backfill; lead name → `/admin/users/[id]` with orders + total spent. Purely additive.
2. **Cycle & reopen** — D1 + badges.
3. **Reps + assignment** — D4 + assigned-rep filter + segment chips.
4. **Reporting** — D5 leaderboard.
5. **Identity hygiene** — email+phone reconcile + manual merge-two-leads action.

## Risks & mitigations
- **Reopen guard is the whole ballgame** — wrong condition either reopens won leads on every sweep or never reopens. Dedicated concurrent-sync tests (copy `razorpayWebhookRace.test.js`).
- **LTV drift** — incremental counters diverge from truth (refunds, missed webhooks). Mitigated by the reconcile job in D2.
- **Full-admin reps** — deliberate, logged tradeoff; the `isSalesRep(user)` seam keeps the later split cheap. "Later" must not become "never."
- **Prod backfills** — dry-run + idempotency (D6). Flush Redis `route:*`/`public:*` after.

## Confidence: **High.**
Design is settled; the operational sharp edges (reopen guard, LTV reconcile, attribution rule, dry-run backfills) are decided above rather than deferred.
