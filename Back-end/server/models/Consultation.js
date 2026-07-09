import mongoose from "mongoose";

const ConsultationSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true },
    whatsapp:      { type: String, required: true, trim: true },
    // Required so the CRM lead anchors on email (the canonical identity key used
    // by accounts + orders), letting a consultation auto-dedup onto the same
    // person's account/order lead without any phone-based stitching.
    email:         { type: String, required: true, trim: true, lowercase: true },
    city:          { type: String, required: true, trim: true },
    vehicleNumber: { type: String, trim: true, default: "" },
    makeModel:     { type: String, required: true, trim: true },
    upgrades:      [{ type: String, trim: true }],
    usage:         { type: String, default: "" },         // Daily / Highway / Performance / City
    drivingStyle:  { type: String, default: "" },         // Normal / Spirited / Aggressive
    mode:          { type: String, default: "In-Person" },// In-Person / Online
    preferredDate: { type: Date },
    preferredTime: { type: String, default: "" },
    notes:         { type: String, default: "" },
    status: {
      type: String,
      enum: ["new", "contacted", "completed", "cancelled"],
      default: "new",
    },
  },
  { timestamps: true }
);

ConsultationSchema.index({ status: 1 });
ConsultationSchema.index({ createdAt: -1 });
ConsultationSchema.index({ whatsapp: 1 });
ConsultationSchema.index({ email: 1 });

export default mongoose.model("Consultation", ConsultationSchema);
