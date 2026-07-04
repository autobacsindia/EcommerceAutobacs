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
  LEAD_TO_CONSULTATION,
  CONSULTATION_TO_LEAD,
} from '../config/leadConstants.js';

// Order statuses that count as a completed purchase (drives conversion + tag).
const PAID_STATUSES = new Set(['confirmed', 'processing', 'shipped', 'delivered', 'refunded']);

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
    const existing = refId ? lead.sources.find((s) => s.ref?.toString() === refId) : null;
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

  /** Remove a source that references `refId`; returns the updated lead or null. */
  async _detachSource(refId, { lostReason } = {}) {
    const id = refId.toString();
    const lead = await leadRepository.findOne({ 'sources.ref': refId });
    if (!lead) return null;

    lead.sources = lead.sources.filter((s) => s.ref?.toString() !== id);
    // A lead with no remaining pre-purchase signal and no conversion is dead —
    // mark it lost rather than leaving an empty husk in the pipeline.
    if (lead.sources.length === 0 && lead.status !== 'won') {
      lead.status = 'lost';
      if (lostReason) lead.lostReason = lostReason;
      lead.activities.push({ type: 'status_change', at: new Date(), notes: `Auto-lost: ${lostReason || 'source removed'}` });
    } else {
      lead.primarySource = this._highestPrioritySource(lead.sources);
    }
    await leadRepository.save(lead);
    return lead;
  }

  // ── Source ingestors ────────────────────────────────────────────────────────

  /** Consultation submitted/updated → warm lead (phone-only identity). */
  async upsertFromConsultation(consultation) {
    return this._upsertSource(
      { name: consultation.name, phone: consultation.whatsapp },
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
   *  - failed   → payment_failed signal
   *  - paid     → conversion (mark won, tag as customer) — never creates a lead
   *  - cancelled→ detach (admin action, not a lost prospect) — never creates a lead
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

    if (doc.status === 'cancelled') {
      return this._detachSource(doc._id, { lostReason: 'order_cancelled' });
    }

    if (PAID_STATUSES.has(doc.status)) {
      return this._markConvertedByIdentity({ email, phone }, doc._id, doc.user);
    }

    const type = doc.status === 'failed' ? 'payment_failed' : doc.status === 'pending' ? 'payment_pending' : null;
    if (!type) return null; // other transient states carry no lead signal

    return this._upsertSource(
      { name, email, phone },
      {
        type,
        ref: doc._id,
        refModel: 'Order',
        snapshot: { total: doc.totalAmount, itemCount: doc.items?.length || 0, orderNumber: doc.orderNumber },
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
  async applyLeadStatus(leadId, status, { actorId, notes, lostReason, convertedOrder, meta, mirror = true } = {}) {
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
  async logActivity(leadId, { type, actorId, notes, meta, nextFollowUpAt }) {
    const lead = await leadRepository.findById(leadId);
    if (!lead) return null;

    const contactMade = ['call', 'note', 'email', 'sms'].includes(type);
    lead.activities.push({ type, by: actorId, at: new Date(), notes: notes || '', meta: meta || {} });
    if (contactMade) {
      lead.lastContactedAt = new Date();
      lead.contactedBy = actorId;
    }
    if (nextFollowUpAt !== undefined) lead.nextFollowUpAt = nextFollowUpAt ? new Date(nextFollowUpAt) : null;
    await leadRepository.save(lead);

    // A first contact bumps a brand-new lead into "contacted" (mirrors out too).
    if (contactMade && lead.status === 'new') {
      return this.applyLeadStatus(lead._id, 'contacted', { actorId, notes: 'First contact logged' });
    }
    return lead;
  }

  claimLead(leadId, adminId) {
    return leadRepository.claimIfUnassigned(leadId, adminId);
  }

  releaseLead(leadId, adminId, opts) {
    return leadRepository.releaseIfOwner(leadId, adminId, opts);
  }
}

export default new LeadSyncService();
