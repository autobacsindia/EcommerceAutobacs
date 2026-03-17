import mongoose from "mongoose";

const MediaItemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["image", "video"], required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // For images: file URL; for videos: embed URL (YouTube/Vimeo) or direct URL
    url: { type: String, required: true },
    thumbnail: { type: String, default: "" },
    album: { type: String, default: "General" },      // group images into albums
    category: { type: String, default: "General" },   // for videos: Tutorials, Promotions, etc.
    tags: [{ type: String, trim: true }],
    featured: { type: Boolean, default: false },
    status: { type: String, enum: ["draft", "published"], default: "published" },
    // Video-specific
    embedType: { type: String, enum: ["youtube", "vimeo", "local", ""], default: "" },
    duration: { type: String, default: "" },
  },
  { timestamps: true }
);

MediaItemSchema.index({ type: 1, status: 1 });
MediaItemSchema.index({ album: 1 });
MediaItemSchema.index({ category: 1 });

export default mongoose.model("MediaItem", MediaItemSchema);
