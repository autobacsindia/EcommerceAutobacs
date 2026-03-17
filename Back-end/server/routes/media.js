import express from "express";
import Article from "../models/Article.js";
import MediaItem from "../models/MediaItem.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// ─── Simple in-memory cache ───────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) { cache.set(key, { data, ts: Date.now() }); }
function cacheInvalidate(prefix) {
  for (const key of cache.keys()) { if (key.startsWith(prefix)) cache.delete(key); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractYoutubeId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  return match ? match[1] : null;
}

function extractVimeoId(url) {
  const match = url.match(/vimeo\.com\/(\d+)/);
  return match ? match[1] : null;
}

function resolveEmbedType(url) {
  if (!url) return "";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("vimeo.com")) return "vimeo";
  return "local";
}

// ─── PUBLIC: Articles (News & Blogs) ─────────────────────────────────────────

// GET /media/articles?type=news|blog&category=&tag=&search=&sort=views|date&page=&limit=
router.get("/articles", asyncHandler(async (req, res) => {
  const { type, category, tag, search, featured, sort, page = 1, limit = 12 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = { status: "published" };
  if (type && ["news", "blog"].includes(type)) query.type = type;
  if (category) query.category = { $regex: category, $options: "i" };
  if (tag) query.tags = { $in: [tag] };
  if (featured === "true") query.featured = true;
  if (search) {
    // Use full-text index when available, fall back to regex
    try {
      query.$text = { $search: search };
    } catch (_) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { excerpt: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }
  }

  // sort=views → trending; default = newest first
  const sortOrder = sort === "views" ? { views: -1 } : { publishedAt: -1, createdAt: -1 };

  // Cache only first-page, no-search requests
  const cacheKey = search ? null : `articles:${type||'all'}:${category||''}:${tag||''}:${featured||''}:${sort||''}:${page}:${limit}`;
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
  }

  const [articles, total] = await Promise.all([
    Article.find(query)
      .select("title slug type coverImage excerpt category tags author featured views publishedAt createdAt")
      .sort(sortOrder)
      .skip(skip)
      .limit(parseInt(limit)),
    Article.countDocuments(query),
  ]);

  const payload = {
    success: true,
    data: articles,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  };

  if (cacheKey) cacheSet(cacheKey, payload);
  res.json(payload);
}));

// GET /media/articles/:slug  — single article by slug
router.get("/articles/:slug", asyncHandler(async (req, res) => {
  const cacheKey = `article:${req.params.slug}`;
  const cached = cacheGet(cacheKey);

  // Cache hit: still increment views in background
  if (cached) {
    Article.updateOne({ slug: req.params.slug }, { $inc: { views: 1 } }).catch(() => {});
    return res.json(cached);
  }

  const article = await Article.findOne({ slug: req.params.slug, status: "published" });
  if (!article) {
    return res.status(404).json({ success: false, message: "Article not found" });
  }

  // Increment view count
  article.views += 1;
  await article.save();

  // Related articles (same type + category, excluding current)
  const related = await Article.find({
    status: "published",
    type: article.type,
    category: article.category,
    _id: { $ne: article._id },
  })
    .select("title slug coverImage excerpt publishedAt type")
    .sort({ publishedAt: -1 })
    .limit(4);

  const payload = { success: true, data: article, related };
  cacheSet(cacheKey, payload);
  res.json(payload);
}));

// GET /media/articles-categories?type=news|blog
router.get("/articles-categories", asyncHandler(async (req, res) => {
  const { type } = req.query;
  const match = { status: "published" };
  if (type) match.type = type;

  const categories = await Article.distinct("category", match);
  res.json({ success: true, data: categories.filter(Boolean).sort() });
}));

// GET /media/trending?type=news|blog&limit=5
router.get("/trending", asyncHandler(async (req, res) => {
  const { type, limit = 5 } = req.query;
  const cacheKey = `trending:${type||'all'}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const query = { status: "published" };
  if (type && ["news", "blog"].includes(type)) query.type = type;

  const articles = await Article.find(query)
    .select("title slug type coverImage category views publishedAt")
    .sort({ views: -1 })
    .limit(parseInt(limit));

  const payload = { success: true, data: articles };
  cacheSet(cacheKey, payload);
  res.json(payload);
}));

// GET /media/stats  — admin analytics summary
router.get("/stats", protect, admin, asyncHandler(async (req, res) => {
  const [totalArticles, publishedArticles, totalNews, totalBlogs, topArticles, totalImages, totalVideos] = await Promise.all([
    Article.countDocuments(),
    Article.countDocuments({ status: "published" }),
    Article.countDocuments({ type: "news", status: "published" }),
    Article.countDocuments({ type: "blog", status: "published" }),
    Article.find({ status: "published" })
      .select("title slug type views publishedAt")
      .sort({ views: -1 })
      .limit(10),
    MediaItem.countDocuments({ type: "image" }),
    MediaItem.countDocuments({ type: "video" }),
  ]);

  res.json({
    success: true,
    data: {
      articles: { total: totalArticles, published: publishedArticles, news: totalNews, blogs: totalBlogs },
      media: { images: totalImages, videos: totalVideos },
      topArticles,
    },
  });
}));

// ─── PUBLIC: Media (Images & Videos) ─────────────────────────────────────────

// GET /media/gallery?album=&page=&limit=
router.get("/gallery", asyncHandler(async (req, res) => {
  const { album, page = 1, limit = 24 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = { type: "image", status: "published" };
  if (album && album !== "all") query.album = { $regex: album, $options: "i" };

  const [items, total, albums] = await Promise.all([
    MediaItem.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    MediaItem.countDocuments(query),
    MediaItem.distinct("album", { type: "image", status: "published" }),
  ]);

  res.json({
    success: true,
    data: items,
    albums: albums.filter(Boolean).sort(),
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
}));

// GET /media/videos?category=&page=&limit=
router.get("/videos", asyncHandler(async (req, res) => {
  const { category, page = 1, limit = 12 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = { type: "video", status: "published" };
  if (category && category !== "all") query.category = { $regex: category, $options: "i" };

  const [items, total, categories] = await Promise.all([
    MediaItem.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    MediaItem.countDocuments(query),
    MediaItem.distinct("category", { type: "video", status: "published" }),
  ]);

  res.json({
    success: true,
    data: items,
    categories: categories.filter(Boolean).sort(),
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
}));

// ─── ADMIN: Articles CRUD ─────────────────────────────────────────────────────

// GET /media/admin/articles
router.get("/admin/articles", protect, admin, asyncHandler(async (req, res) => {
  const { type, status, page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (type) query.type = type;
  if (status) query.status = status;

  const [articles, total] = await Promise.all([
    Article.find(query)
      .select("title slug type category status featured views publishedAt createdAt author")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Article.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: articles,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
}));

// GET /media/admin/articles/:id
router.get("/admin/articles/:id", protect, admin, asyncHandler(async (req, res) => {
  const article = await Article.findById(req.params.id);
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });
  res.json({ success: true, data: article });
}));

// POST /media/admin/articles
router.post("/admin/articles", protect, admin, asyncHandler(async (req, res) => {
  const { title, type, coverImage, excerpt, content, category, tags, author, status, featured } = req.body;

  if (!title || !content) {
    return res.status(400).json({ success: false, message: "Title and content are required" });
  }

  // Auto-generate unique slug
  let baseSlug = generateSlug(title);
  let slug = baseSlug;
  let counter = 1;
  while (await Article.findOne({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const article = await Article.create({
    title, slug, type: type || "news", coverImage, excerpt, content,
    category: category || "General",
    tags: tags || [],
    author: author || "Autobacs Team",
    status: status || "draft",
    featured: featured || false,
  });

  cacheInvalidate("articles:");
  cacheInvalidate("trending:");
  res.status(201).json({ success: true, data: article });
}));

// PUT /media/admin/articles/:id
router.put("/admin/articles/:id", protect, admin, asyncHandler(async (req, res) => {
  const article = await Article.findById(req.params.id);
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });

  const fields = ["title", "type", "coverImage", "excerpt", "content", "category", "tags", "author", "status", "featured"];
  fields.forEach((f) => { if (req.body[f] !== undefined) article[f] = req.body[f]; });

  // Regenerate slug if title changed
  if (req.body.title && req.body.title !== article.title) {
    let baseSlug = generateSlug(req.body.title);
    let slug = baseSlug;
    let counter = 1;
    while (await Article.findOne({ slug, _id: { $ne: article._id } })) {
      slug = `${baseSlug}-${counter++}`;
    }
    article.slug = slug;
  }

  await article.save();
  cacheInvalidate("articles:");
  cacheInvalidate("trending:");
  cache.delete(`article:${article.slug}`);
  res.json({ success: true, data: article });
}));

// DELETE /media/admin/articles/:id
router.delete("/admin/articles/:id", protect, admin, asyncHandler(async (req, res) => {
  const article = await Article.findByIdAndDelete(req.params.id);
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });
  cacheInvalidate("articles:");
  cacheInvalidate("trending:");
  cache.delete(`article:${article.slug}`);
  res.json({ success: true, message: "Article deleted" });
}));

// ─── ADMIN: Media Items CRUD ──────────────────────────────────────────────────

// GET /media/admin/media-items?type=image|video
router.get("/admin/media-items", protect, admin, asyncHandler(async (req, res) => {
  const { type, page = 1, limit = 24 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (type) query.type = type;

  const [items, total] = await Promise.all([
    MediaItem.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    MediaItem.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: items,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
}));

// POST /media/admin/media-items
router.post("/admin/media-items", protect, admin, asyncHandler(async (req, res) => {
  const { type, title, description, url, thumbnail, album, category, tags, featured, status, duration } = req.body;

  if (!type || !title || !url) {
    return res.status(400).json({ success: false, message: "Type, title, and URL are required" });
  }

  const embedType = type === "video" ? resolveEmbedType(url) : "";

  // Auto-generate thumbnail for YouTube if not provided
  let finalThumbnail = thumbnail;
  if (type === "video" && !thumbnail) {
    const ytId = extractYoutubeId(url);
    if (ytId) finalThumbnail = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    const vimeoId = extractVimeoId(url);
    if (vimeoId) finalThumbnail = `https://vumbnail.com/${vimeoId}.jpg`;
  }

  const item = await MediaItem.create({
    type, title, description, url,
    thumbnail: finalThumbnail || "",
    album: album || "General",
    category: category || "General",
    tags: tags || [],
    featured: featured || false,
    status: status || "published",
    embedType,
    duration: duration || "",
  });

  res.status(201).json({ success: true, data: item });
}));

// PUT /media/admin/media-items/:id
router.put("/admin/media-items/:id", protect, admin, asyncHandler(async (req, res) => {
  const item = await MediaItem.findById(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Media item not found" });

  const fields = ["title", "description", "url", "thumbnail", "album", "category", "tags", "featured", "status", "duration"];
  fields.forEach((f) => { if (req.body[f] !== undefined) item[f] = req.body[f]; });

  if (req.body.url && item.type === "video") {
    item.embedType = resolveEmbedType(req.body.url);
  }

  await item.save();
  res.json({ success: true, data: item });
}));

// DELETE /media/admin/media-items/:id
router.delete("/admin/media-items/:id", protect, admin, asyncHandler(async (req, res) => {
  const item = await MediaItem.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Media item not found" });
  res.json({ success: true, message: "Media item deleted" });
}));

export default router;
