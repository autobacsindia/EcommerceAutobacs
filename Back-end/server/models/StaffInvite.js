import mongoose from "mongoose";
import { STAFF_TEAM_VALUES } from "../config/staff.js";

/**
 * StaffInvite — a pending grant of staff access, redeemed by an emailed link.
 *
 * Access is never granted at invite time. The invitee proves they control the
 * address by opening the link and setting a password; only then does the User
 * become (or get created as) staff. This matters because staff use personal
 * emails, which may already belong to a customer account.
 *
 * Only the SHA-256 of the token is stored. Rows are kept after acceptance or
 * revocation as an audit trail of who granted whom access, so there is no TTL.
 */
const StaffInviteSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    team: { type: String, enum: STAFF_TEAM_VALUES, required: true },
    isHead: { type: Boolean, default: false },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

StaffInviteSchema.index({ tokenHash: 1 }, { unique: true }); // redeem lookup
StaffInviteSchema.index({ team: 1, acceptedAt: 1, revokedAt: 1 }); // pending list per team
StaffInviteSchema.index({ email: 1, acceptedAt: 1, revokedAt: 1 }); // supersede older invites

export default mongoose.model("StaffInvite", StaffInviteSchema);
