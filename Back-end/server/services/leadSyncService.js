/**
 * leadSyncService — the ONLY writer that maps lead sources onto Lead documents.
 *
 * Centralising every source→Lead and Lead→source write here is what keeps the
 * bidirectional status mirror (Lead ↔ Consultation) from looping or drifting:
 * there is exactly one status-change path (`applyLeadStatus`) and it only writes
 * the source table when the mapped value actually differs.
 *
 * All methods are best-effort by design — a CRM sync failure must never break the
 * originating flow (placing an order, submitting a consultation). Callers wrap in
 * `safeSync(...)`; the hourly/daily sweeps reconcile anything a lost update drops.
 */

import leadRepository from '../repositories/leadRepository.js';
import consultationRepository from '../repositories/consultationRepository.js';
import userRepository from '../repositories/userRepository.js';
import { normalizeEmail, normalizePhone, buildIdentityKey } from '../utils/identity.js';
import {
  SOURCE_PRIORITY,
  REOPEN_SOURCE_TYPES,
  TERMINAL_LEAD_STATUSES,
  LEAD_TO_CONSULTATION,
  CONSULTATION_TO_LEAD,
} from '../config/leadConstants.js';

// Max line items to denormalize onto a lead source snapshot — keeps it "intentionally
// tiny" (see Lead.js LeadSourceSchema) while still telling sales what the prospect wanted.
const MAX_SNAPSHOT_ITEMS = 10;

/**
 * Compact, join-free view of an order's cart for the lead snapshot: what the prospect
 * had at checkout so a rep can follow up with specifics. Names/prices are already
 * snapshotted on the order line item, so no Product lookup is needed.
 */
function orderItemsSnapshot(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.slice(0, MAX_SNAPSHOT_ITEMS).map((it) => ({
    name: it.name || null,
    quantity: it.quantity,
    price: it.price,
  }));
}

class LeadSyncService {
  /** Run a sync operation without ever throwing into the caller's flow. */
  async safeSync(fn) {
    try {
      return await fn();
    } catch (err) {
      console.error('[leadSync] sync failed:', err?.message);
      return null;
    }
  }

  _highestPrioritySource(sources) {
    return sources.reduce(
      (best, s) => (SOURCE_PRIORITY[s.type] > SOURCE_PRIORITY[best] ? s.type : best),
      sources[0]?.type
    );
  }

  /**
   * Archive the current (won/lost) cycle into `cycles[]` and reset the lead to a
   * fresh `new` cycle back in the pool. Preserves the PERMANENT person facts
   * (identity, hasPurchased, linkedUser) and the full audit trail (cycles[] +
   * activity log); clears only the working state of the closed cycle. The caller
   * pushes the triggering source onto the now-empty `sources[]`. See ADR-006.
   */
  _closeCycleAndReset(lead, triggerType) {
    const now = new Date();
    const outcome = lead.status; // 'won' | 'lost'
    lead.cycles.push({
      startedAt: lead.cycleStartedAt || lead.createdAt,
      closedAt: lead.convertedAt || now,
      outcome,
      sources: lead.sources.map((s) => ({
        type: s.type,
        ref: s.ref,
        refModel: s.refModel,
        snapshot: s.snapshot,
        capturedAt: s.capturedAt,
      })),
      primarySource: lead.primarySource,
      assignedRep: lead.assignedRep, // credited rep at close — preserves who won it
      assignedTo: lead.assignedTo,
      contactedBy: lead.contactedBy,
      convertedOrder: lead.convertedOrder,
      convertedAt: lead.convertedAt,
      lostReason: lead.lostReason,
    });

    // Reset the working state for the new cycle (identity + customer facts kept).
    // Ownership clears too, so the reopened lead genuinely returns to the shared
    // pool (assignedRep null) rather than staying stuck under the previous rep.
    lead.sources = [];
    lead.status = 'new';
    lead.assignedRep = null;
    lead.assignedTo = null;
    lead.assignedAt = null;
    lead.contactedBy = null;
    lead.lastContactedAt = null;
    lead.nextFollowUpAt = null;
    lead.lostReason = '';
    lead.convertedOrder = null;
    lead.convertedAt = null;
    lead.cycleStartedAt = now;
    lead.reopenCount = (lead.reopenCount || 0) + 1;

    lead.activities.push({
      type: 'status_change',
      at: now,
      notes: `Reopened — new ${triggerType} signal after cycle closed as ${outcome}`,
      meta: { reopen: true, previousOutcome: outcome, trigger: triggerType },
    });
  }

  /**
   * Core upsert: attach a source signal to the lead for `identity`, creating the
   * lead on first sighting. Idempotent per (identity, source ref).
   *
   * @param {{email?:string, phone?:string, name?:string}} identity
   * @param {{type:string, ref?:any, refModel?:string, snapshot?:object}} source
   * @param {{linkedUser?:any, hasPurchased?:boolean}} [extra]
   * @returns the lead, or null when there is no usable contact to dedup on.
   */
  async _upsertSource(identity, source, extra = {}) {
    const email = normalizeEmail(identity.email);
    const phone = normalizePhone(identity.phone);
    const identityKey = buildIdentityKey({ email, phone });
    if (!identityKey) return null; // no contact info → can't be worked, skip

    let lead = await leadRepository.findByIdentityKey(identityKey);
    if (!lead) {
      try {
        lead = await leadRepository.create({ identityKey, name: identity.name || '', email, phone, status: 'new' });
      } catch (err) {
        if (err?.code === 11000) {
          lead = await leadRepository.findByIdentityKey(identityKey); // lost a create race → adopt existing
        } else {
          throw err;
        }
      }
    }
    if (!lead) return null;

    // Backfill identity fields we didn't have before (never overwrite good data).
    if (identity.name && !lead.name) lead.name = identity.name;
    if (email && !lead.email) lead.email = email;
    if (phone && !lead.phone) lead.phone = phone;
    if (extra.linkedUser && !lead.linkedUser) lead.linkedUser = extra.linkedUser;
    if (extra.hasPurchased) lead.hasPurchased = true;

    // Merge the source (dedup by ref). Refresh snapshot/capturedAt if already present.
    const refId = source.ref ? source.ref.toString() : null;
    let existing = refId ? lead.sources.find((s) => s.ref?.toString() === refId) : null;

    // A genuinely NEW signal = a new ref, OR a known ref whose TYPE is PROGRESSING
    // (e.g. the same order going payment_pending → order_cancelled). A same-type
    // re-sync (webhook retry) is not new. Using type-progression — not just a new
    // ref — keeps reopen behaviour consistent: cancelling a won order re-engages
    // the lead whether or not a prior payment_pending signal happened to be stored.
    const isNewSignal = !existing || existing.type !== source.type;

    // Reopen-with-history: a genuinely new, workable signal landing on a CLOSED
    // (won/lost) lead starts a fresh cycle. Guards:
    //   • isNewSignal          — a plain re-sync (same ref + same type) refreshes.
    //   • REOPEN_SOURCE_TYPES  — passive `dormant_user` sweeps are excluded, so a
    //                            time-based signal can't resurrect a closed decision.
    //   • terminal status      — active leads just append; only won/lost reopen.
    // The paid-order path never reaches here (it goes through
    // _markConvertedByIdentity), so a conversion can't reopen itself.
    if (isNewSignal && TERMINAL_LEAD_STATUSES.includes(lead.status) && REOPEN_SOURCE_TYPES.includes(source.type)) {
      this._closeCycleAndReset(lead, source.type);
      existing = null; // sources were cleared — fall through to push the new one
    }

    if (existing) {
      existing.type = source.type;
      existing.snapshot = source.snapshot || existing.snapshot;
      existing.capturedAt = new Date();
    } else {
      lead.sources.push({
        type: source.type,
        ref: source.ref,
        refModel: source.refModel,
        snapshot: source.snapshot || {},
        capturedAt: new Date(),
      });
    }

    lead.primarySource = this._highestPrioritySource(lead.sources);
    await leadRepository.save(lead);
    return lead;
  }

  // ── Source ingestors ────────────────────────────────────────────────────────

  /**
   * Consultation submitted/updated → warm lead. Email is captured on the form and
   * is the canonical identity key, so the lead dedups onto the same person's
   * account/order lead automatically (no phone-based stitching needed); the phone
   * is still carried for backfill/contact and as a fallback for legacy rows.
   */
  async upsertFromConsultation(consultation) {
    return this._upsertSource(
      { name: consultation.name, email: consultation.email, phone: consultation.whatsapp },
      {
        type: 'consultation',
        ref: consultation._id,
        refModel: 'Consultation',
        snapshot: {
          makeModel: consultation.makeModel,
          city: consultation.city,
          upgrades: consultation.upgrades,
          mode: consultation.mode,
        },
      }
    );
  }

  /**
   * Order changed state → sync the matching lead.
   *  - pending  → payment_pending signal ("left at checkout")
   *  - expired  → payment_pending too (abandoned & auto-settled by the sweep — same
   *               "left at checkout" prospect, just closed out on the order side)
   *  - failed   → payment_failed signal
   *  - paid     → conversion (mark won, tag as customer) — never creates a lead
   *  - cancelled→ order_cancelled re-engagement signal (admin OR customer cancel).
   *               The same order ref that carried payment_pending is upgraded in
   *               place to order_cancelled, so the person stays workable in the CRM.
   */
  async upsertFromOrder(order) {
    const doc = order;
    // Best contact: guest email/phone on the order, else the linked user's.
    let email = doc.guestEmail || null;
    let phone = doc.shippingAddress?.phone || null;
    let name = doc.shippingAddress?.fullName || null;
    if ((!email || !phone) && doc.user) {
      const user = await userRepository.findById(doc.user);
      if (user) {
        email = email || user.email;
        phone = phone || user.phone;
        name = name || user.name;
      }
    }

    // A cancelled order is a re-engagement target, not a dead end — surface it as
    // an `order_cancelled` lead so sales can follow up and try to re-close. This
    // holds whether the money was captured (cancel-with-refund) or not.
    if (doc.status === 'cancelled') {
      return this._upsertSource(
        { name, email, phone },
        {
          type: 'order_cancelled',
          ref: doc._id,
          refModel: 'Order',
          snapshot: {
            total: doc.totalAmount,
            itemCount: doc.items?.length || 0,
            items: orderItemsSnapshot(doc),
            orderNumber: doc.orderNumber,
            cancelledBy: doc.cancelledBy || null,
            wasPaid: doc.paymentStatus === 'paid' || doc.paymentStatus === 'refunded',
          },
        },
        { linkedUser: doc.user || null }
      );
    }

    // Read the PAYMENT axis (paymentStatus), not fulfillment — payment success/
    // failure/abandonment are payment facts now (post two-axis split).
    if (doc.paymentStatus === 'paid') {
      // Offline link flow deferred conversion of a specific lead to payment time.
      // Convert it explicitly (its identity may not match the order's), crediting
      // the closing rep — separate from the identity-based conversion below.
      if (doc.crmLeadId) {
        await this.safeSync(() =>
          this.applyLeadStatus(doc.crmLeadId, 'won', {
            repId: doc.salesRep || null,
            notes: 'Closed via offline payment link',
            convertedOrder: doc._id,
          })
        );
      }
      return this._markConvertedByIdentity({ email, phone }, doc._id, doc.user);
    }

    const type =
      doc.paymentStatus === 'failed'
        ? 'payment_failed'
        : doc.paymentStatus === 'cancelled'
          ? 'payment_cancelled' // customer dismissed the payment popup
          : (doc.paymentStatus === 'pending' || doc.paymentStatus === 'expired') && doc.status === 'awaiting_payment'
            ? 'payment_pending' // created, never paid (still stuck OR auto-expired) → "left at checkout"
            : null;
    if (!type) return null; // other states carry no lead signal

    return this._upsertSource(
      { name, email, phone },
      {
        type,
        ref: doc._id,
        refModel: 'Order',
        snapshot: {
          total: doc.totalAmount,
          itemCount: doc.items?.length || 0,
          items: orderItemsSnapshot(doc),
          orderNumber: doc.orderNumber,
        },
      },
      { linkedUser: doc.user || null }
    );
  }

  /** Abandoned cart (items present, no order) with usable contact → warm lead. */
  async upsertFromCart(cart, { user } = {}) {
    if (!cart?.items?.length) return null;
    const email = user?.email || cart.guestEmail || null;
    const phone = user?.phone || cart.guestPhone || null;
    return this._upsertSource(
      { name: user?.name, email, phone },
      {
        type: 'cart_abandoned',
        ref: cart._id,
        refModel: 'Cart',
        snapshot: { itemCount: cart.items.length },
      },
      { linkedUser: user?._id || cart.user || null }
    );
  }

  /** Registered user who never placed a paid order → cold re-engagement lead. */
  async upsertFromDormantUser(user) {
    return this._upsertSource(
      { name: user.name, email: user.email, phone: user.phone },
      { type: 'dormant_user', ref: user._id, refModel: 'User', snapshot: {} },
      { linkedUser: user._id }
    );
  }

  // ── Conversion ──────────────────────────────────────────────────────────────

  /** On a paid order: mark the identity's lead won + tag as customer. */
  async _markConvertedByIdentity({ email, phone }, orderId, userId) {
    const identityKey = buildIdentityKey({ email, phone });
    if (!identityKey) return null;
    const lead = await leadRepository.findByIdentityKey(identityKey);
    if (!lead) return null;

    // Persist the tag/link FIRST — applyLeadStatus reloads a fresh doc, so an
    // unsaved in-memory change here would be lost.
    lead.hasPurchased = true;
    if (userId && !lead.linkedUser) lead.linkedUser = userId;
    await leadRepository.save(lead);

    if (lead.status !== 'won') {
      return this.applyLeadStatus(lead._id, 'won', {
        repId: lead.assignedRep || null, // credit the owner-at-close on the conversion (matches offline)
        notes: 'Auto-converted: order paid',
        meta: { orderId },
        convertedOrder: orderId,
      });
    }
    return lead;
  }

  // ── Status (single write path) ──────────────────────────────────────────────

  /**
   * The one place a lead's status changes. Logs the change, handles won/lost
   * side-effects, and mirrors OUT to a linked Consultation (guarded on a real
   * difference so it can't ping-pong). Pass `mirror:false` when the change
   * originated FROM the consultation admin, to avoid writing back.
   */
  async applyLeadStatus(leadId, status, { actorId, repId, notes, lostReason, convertedOrder, meta, mirror = true } = {}) {
    const lead = await leadRepository.findById(leadId);
    if (!lead) return null;
    if (lead.status === status && !convertedOrder) return lead; // no-op guard (loop safety)

    const prev = lead.status;
    lead.status = status;
    if (status === 'won') {
      lead.convertedAt = lead.convertedAt || new Date();
      if (convertedOrder) lead.convertedOrder = convertedOrder;
    }
    if (status === 'lost' && lostReason) lead.lostReason = lostReason;
    if (status === 'contacted' && !lead.lastContactedAt) {
      lead.lastContactedAt = new Date();
      if (actorId) lead.contactedBy = actorId;
    }
    lead.activities.push({
      type: status === 'won' ? 'conversion' : 'status_change',
      by: actorId,
      rep: repId || null,
      at: new Date(),
      notes: notes || `Status ${prev} → ${status}`,
      meta: meta || {},
    });
    await leadRepository.save(lead);

    if (mirror) await this._mirrorToConsultation(lead, status);
    return lead;
  }

  /** Write the mapped status onto the lead's Consultation source, if different. */
  async _mirrorToConsultation(lead, leadStatus) {
    const consultationSource = lead.sources.find((s) => s.type === 'consultation' && s.ref);
    if (!consultationSource) return;
    const target = LEAD_TO_CONSULTATION[leadStatus];
    if (!target) return;
    const consultation = await consultationRepository.findById(consultationSource.ref);
    if (consultation && consultation.status !== target) {
      await consultationRepository.update(consultation._id, { status: target });
    }
  }

  /**
   * Mirror IN: the consultation admin changed a status → reflect it on the lead.
   * Uses `mirror:false` so we don't immediately write back to the consultation.
   */
  async syncFromConsultationStatus(consultationId, consultationStatus) {
    const target = CONSULTATION_TO_LEAD[consultationStatus];
    if (!target) return null;
    const lead = await leadRepository.findOne({ 'sources.ref': consultationId, 'sources.type': 'consultation' });
    if (!lead) return null;
    return this.applyLeadStatus(lead._id, target, {
      notes: `Mirrored from consultancy (${consultationStatus})`,
      mirror: false,
    });
  }

  // ── Activity + assignment ────────────────────────────────────────────────────

  /** Log an interaction. Calls/notes/emails mark the lead contacted. */
  async logActivity(leadId, { type, actorId, repId, notes, meta, nextFollowUpAt }) {
    const lead = await leadRepository.findById(leadId);
    if (!lead) return null;

    const contactMade = ['call', 'note', 'email', 'sms'].includes(type);
    lead.activities.push({ type, by: actorId, rep: repId || null, at: new Date(), notes: notes || '', meta: meta || {} });
    if (contactMade) {
      lead.lastContactedAt = new Date();
      lead.contactedBy = actorId;
    }
    if (nextFollowUpAt !== undefined) lead.nextFollowUpAt = nextFollowUpAt ? new Date(nextFollowUpAt) : null;
    await leadRepository.save(lead);

    // A first contact bumps a brand-new lead into "contacted" (mirrors out too).
    if (contactMade && lead.status === 'new') {
      return this.applyLeadStatus(lead._id, 'contacted', { actorId, repId, notes: 'First contact logged' });
    }
    return lead;
  }

  /** Atomic claim for a named rep (compare-and-set on the pool). */
  claimLead(leadId, repId, adminId) {
    return leadRepository.claimRepIfUnassigned(leadId, repId, adminId);
  }

  /** Release a lead's named owner back to the pool. */
  releaseLead(leadId, adminId) {
    return leadRepository.releaseRep(leadId, adminId);
  }
}

export default new LeadSyncService();
