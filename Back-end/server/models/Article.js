import mongoose from "mongoose";

const ArticleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    type: { type: String, enum: ["news", "blog"], required: true, default: "news" },
    coverImage: { type: String, default: "" },
    excerpt: { type: String, maxlength: 500, default: "" },
    content: { type: String, required: true },
    category: { type: String, default: "General" },
    tags: [{ type: String, trim: true }],
    author: { type: String, default: "Autobacs Team" },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    featured: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    publishedAt: { type: Date },

    // WordPress migration linkage (ADR-005). wpUrl = old permalink, used to build 301 redirects.
    wpId: { type: Number, index: { unique: true, sparse: true } },
    wpUrl: { type: String, trim: true },
  },
  { timestamps: true }
);

ArticleSchema.index({ slug: 1 });
ArticleSchema.index({ type: 1, status: 1 });
ArticleSchema.index({ type: 1, status: 1, publishedAt: -1 });
ArticleSchema.index({ type: 1, status: 1, views: -1 });   // trending
ArticleSchema.index({ tags: 1 });
ArticleSchema.index({ category: 1 });
ArticleSchema.index({ title: 'text', content: 'text', excerpt: 'text', tags: 'text' }, {
  weights: { title: 10, excerpt: 5, tags: 4, content: 1 },
  name: 'article_fulltext',
});

// Auto-set publishedAt when status changes to published
ArticleSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status === "published" && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

export default mongoose.model("Article", ArticleSchema);
