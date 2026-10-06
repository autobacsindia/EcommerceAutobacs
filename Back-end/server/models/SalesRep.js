import mongoose from "mongoose";

/**
 * SalesRep — a lightweight, name-only sales-rep profile.
 *
 * Deliberately NOT a login. The team currently works the CRM under a single
 * shared admin account, so this exists purely to attribute CRM work ("who
 * claimed / closed this") to a named person. A Lead references a SalesRep via
 * `assignedRep`; activities/offline orders record the acting rep.
 *
 * Upgrade path (when reps get their own logins): add an optional `user` ref
 * here and resolve attribution through it — no change to the Lead schema.
 * See [[crm-offline-claim-flow]] / ADR-006.
 */
const SalesRepSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Deactivated reps stay on historical leads (attribution must not vanish) but
    // drop out of the assignable dropdown.
    isActive: { type: Boolean, default: true, index: true },
    // The admin who created the profile — audit only.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // The staff login (team panel) this profile belongs to, when the rep has one.
    // Lets orders a rep creates in /team credit the same CRM profile admins
    // assign on leads. Absent for name-only reps.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

SalesRepSchema.index({ isActive: 1, name: 1 }); // assignable-list default sort
// Case-insensitive unique name — the real guard against duplicate profiles (the
// controller's findByName pre-check is a TOCTOU that concurrent creates can slip
// past). strength:2 makes "Rahul" and "rahul" collide, matching findByName.
SalesRepSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
// One profile per staff login. Partial on $type (not $ne — MongoDB rejects $ne in a
// partialFilterExpression) so the many name-only reps with no user don't collide.
SalesRepSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { user: { $type: "objectId" } } });

export default mongoose.model("SalesRep", SalesRepSchema);
