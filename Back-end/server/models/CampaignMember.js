import mongoose from "mongoose";
import { CAMPAIGN_MEMBER_STATUS, CAMPAIGN_MEMBER_STATUSES } from "../config/campaign.js";

/**
 * CampaignMember — one invited email on a campaign's allowlist.
 *
 * Keyed on EMAIL, not user id, because most invitees may not have an account yet.
 * (For the 2026 festival card, 175 of 207 recipients had only ever ordered over
 * WhatsApp or the Order Manager, so "create your account" is the main path, not the
 * edge case.) `user` is filled in once the invitee logs in with a confirmed matching
 * address, which is also the moment eligibility becomes real.
 *
 * `status` is REPORTING, not enforcement. "Once per customer" is enforced atomically by
 * the managed coupon's per-user usage counter — a guarded upsert against a unique
 * {coupon,user} index. A status field would be a read-then-write with a TOCTOU window
 * that two concurrent checkouts both slip through.
 */
const CampaignMemberSchema = new mongoose.Schema({
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  // Printed on the card; kept so the landing page and any follow-up email can greet
  // the invitee properly. May legitimately be a business name.
  name: { type: String, trim: true },

  status: { type: String, enum: CAMPAIGN_MEMBER_STATUSES, default: CAMPAIGN_MEMBER_STATUS.INVITED },

  // Resolved on first eligible login. Not required — an invite can sit unclaimed.
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  claimedAt: { type: Date, default: null },

  // ── Redemption record (denormalised for the admin dashboard) ─────────────────
  redeemedOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  redeemedAt: { type: Date, default: null },
  discountRupees: { type: Number, min: 0, default: 0 },

  /**
   * ── Postal details, for the thing that started all this: posting the cards ──────
   *
   * Carried on the member rather than looked up from the customer's account, because
   * the two answer different questions. The account address is where that person wants
   * DELIVERIES sent today and they may change it at any time; these are the details the
   * operations list held when the campaign was built, which is what the printed run was
   * addressed from. Keeping them here means a card that came back undelivered can still
   * be traced to what was actually on the envelope.
   *
   * They also survive the person having no account at all — 175 of the 207 people on the
   * 2026 list had only ever ordered over WhatsApp or the Order Manager.
   *
   * Kept as free text, not a structured address: the source is an operations spreadsheet
   * where a single "Delivery Address" cell already holds the whole thing, frequently with
   * landmarks and instructions ("opposite Domino's pizza", "next to Bharat TVS"). Parsing
   * that into lines would lose information a courier actually uses.
   */
  phone: { type: String, trim: true, default: null },
  address: { type: String, trim: true, default: null },
  pincode: { type: String, trim: true, default: null },
  state: { type: String, trim: true, default: null },

  // Free-text note from the import (e.g. "identity to check — email may be a dealer's").
  reviewNote: { type: String, trim: true, default: null },
}, { timestamps: true });

// One invite per email per campaign. Also the lookup used on every eligibility check.
// Created explicitly in config/db.js because autoIndex is off in production.
CampaignMemberSchema.index({ campaign: 1, email: 1 }, { unique: true });
// Resolving "is this logged-in user invited?" without a second email round-trip.
CampaignMemberSchema.index({ campaign: 1, user: 1 });
// Admin funnel counts.
CampaignMemberSchema.index({ campaign: 1, status: 1 });

export default mongoose.model("CampaignMember", CampaignMemberSchema);
