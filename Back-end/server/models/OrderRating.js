import mongoose from "mongoose";
import { ORDER_RATING_COMMENT_MAX } from "../config/orderRatingLimits.js";

/**
 * A customer's rating of the SALE and SERVICE on one delivered order — not of
 * the product (that is Review). Read by the sales incentive engine, so the
 * field names and meanings below are a fixed contract:
 *
 *   order        the rated order; unique, so one rating per order
 *   salesperson  the order's `salesUser` copied at FIRST rating time (null for
 *                a website order nobody was credited with). Not re-read on a
 *                later edit, so re-crediting an order never moves its rating.
 *   stars        integer 1–5
 *   comment      optional, at most ORDER_RATING_COMMENT_MAX characters
 *   source       'link' (signed link from the email) | 'account' (logged in)
 *                | 'salesperson-link' (offline order: link the salesperson sent on
 *                WhatsApp — see `sentBy` / `sameNetworkAsSender`)
 *   createdAt    when it was first given; the 7-day edit window runs from here
 *
 * Written only by services/orderRatingService.js. There is no staff write path.
 */
export { ORDER_RATING_COMMENT_MAX };
export const ORDER_RATING_SOURCES = ["link", "account", "salesperson-link"];

const OrderRatingSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, unique: true },
    salesperson: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: { validator: Number.isInteger, message: "stars must be a whole number" },
    },
    comment: { type: String, trim: true, maxlength: ORDER_RATING_COMMENT_MAX, default: "" },
    source: { type: String, enum: ORDER_RATING_SOURCES, required: true },
    // The signed-in customer who rated, when there was one. Audit only.
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    editCount: { type: Number, default: 0 },
    // 'salesperson-link' only: who created the link, and whether the rating came
    // from the same internet connection the link was created from (a self-rating
    // signal — flagged, not blocked, since a customer may rate at the shop).
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: undefined },
    sameNetworkAsSender: { type: Boolean, default: undefined },
  },
  { timestamps: true }
);

// The incentive engine's read: one salesperson's ratings over a date range.
// prod runs autoIndex off — built by scripts/create-order-rating-indexes.js.
OrderRatingSchema.index({ salesperson: 1, createdAt: -1 }, { name: "salesperson_1_createdAt_-1" });

export default mongoose.models.OrderRating || mongoose.model("OrderRating", OrderRatingSchema);
