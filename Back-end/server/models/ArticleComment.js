import mongoose from "mongoose";

const ArticleCommentSchema = new mongoose.Schema(
  {
    article: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Article",
      required: true,
      index: true,
    },
    name:    { type: String, required: true, trim: true, maxlength: 100 },
    email:   { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    comment: { type: String, required: true, trim: true, maxlength: 2000 },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ArticleComment",
      default: null,
    },
    // auto-approve; add moderation UI later via admin panel
    approved: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("ArticleComment", ArticleCommentSchema);
