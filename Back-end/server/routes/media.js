import express from "express";
import articleRepository from "../repositories/articleRepository.js";
import mediaItemRepository from "../repositories/mediaItemRepository.js";
import ArticleComment from "../models/ArticleComment.js";
import PressCoverage from "../models/PressCoverage.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { normalizeSeo } from "../utils/seo.js";
import { cleanArticleHTML } from "../utils/htmlSanitizer.js";

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

// ─── WP link resolution ───────────────────────────────────────────────────────

const WP_PRODUCT_RE = /https?:\/\/(?:www\.)?autobacsindia\.com\/product\/([^/"'\s>]+)\/?/gi;

async function resolveWpProductLinks(content) {
  if (!content) return content;

  // Collect every unique WP product slug referenced in the content
  const slugs = new Set();
  for (const [, slug] of content.matchAll(WP_PRODUCT_RE)) {
    slugs.add(slug.toLowerCase());
  }
  if (slugs.size === 0) return content;

  // Look up which slugs actually exist in our database
  const found = await Product.find({ slug: { $in: [...slugs] } })
    .select("slug")
    .lean();
  const slugMap = new Map(found.map((p) => [p.slug, p.slug]));

  // Replace product links (verified → /products/slug, unknown → keep original)
  let resolved = content.replace(WP_PRODUCT_RE, (match, wpSlug) => {
    const key = wpSlug.toLowerCase();
    return slugMap.has(key) ? `/products/${slugMap.get(key)}` : match;
  });

  // Structural rewrites that don't need a DB lookup
  resolved = resolved
    .replace(/https?:\/\/(?:www\.)?autobacsindia\.com\/product-category\/([^/"'\s>]+)\/?/gi, "/categories/$1")
    .replace(/https?:\/\/(?:www\.)?autobacsindia\.com\/shop\/?/gi, "/shop");

  return resolved;
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
    articleRepository.find(query)
      .select("title slug type coverImage excerpt category tags author featured views publishedAt createdAt")
      .sort(sortOrder)
      .skip(skip)
      .limit(parseInt(limit)),
    articleRepository.countDocuments(query),
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

// GET /media/articles/sitemap  — lightweight slug list for sitemap generation
// NOTE: must precede "/articles/:slug" so "sitemap" isn't captured as a slug.
// Only published, indexable (non-noindex) BLOG articles — these are served at
// the site root (/<slug>), matching the public route.
router.get("/articles/sitemap", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 2000, 5000);
  const articles = await articleRepository
    .find({ status: "published", type: "blog", "seo.noindex": { $ne: true } })
    .select("slug type updatedAt publishedAt")
    .sort({ publishedAt: -1 })
    .limit(limit)
    .lean();
  res.set("Cache-Control", "public, max-age=3600");
  res.json({ data: articles });
}));

// GET /media/articles/:slug  — single article by slug
router.get("/articles/:slug", asyncHandler(async (req, res) => {
  const cacheKey = `article:${req.params.slug}`;
  const cached = cacheGet(cacheKey);

  // Cache hit: still increment views in background
  if (cached) {
    articleRepository.updateOne({ slug: req.params.slug }, { $inc: { views: 1 } }).catch(() => {});
    return res.json(cached);
  }

  const article = await articleRepository.findOne({ slug: req.params.slug, status: "published" });
  if (!article) {
    return res.status(404).json({ success: false, message: "Article not found" });
  }

  // Increment view count
  article.views += 1;
  await article.save();

  // Related articles (same type + category, excluding current)
  const related = await articleRepository.find({
    status: "published",
    type: article.type,
    category: article.category,
    _id: { $ne: article._id },
  })
    .select("title slug coverImage excerpt publishedAt type")
    .sort({ publishedAt: -1 })
    .limit(4);

  // Rewrite WordPress product/category/shop URLs in content to new-site routes.
  // Only product links that actually exist in the database are rewritten; unknown
  // slugs are left as-is so broken links are visible rather than silently hidden.
  const articleObj = article.toObject();
  articleObj.content = await resolveWpProductLinks(articleObj.content);
  // Sanitize + unwrap WP image links server-side so the frontend can render the
  // body in SSR (SEO) instead of sanitizing client-side after mount. (FE-3)
  articleObj.content = cleanArticleHTML(articleObj.content);

  const payload = { success: true, data: articleObj, related };
  cacheSet(cacheKey, payload);
  res.json(payload);
}));

// GET /media/articles/:slug/adjacent  — prev/next articles of the same type
router.get("/articles/:slug/adjacent", asyncHandler(async (req, res) => {
  const article = await articleRepository.findOne({ slug: req.params.slug, status: "published" });
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });

  const base = { status: "published", type: article.type, _id: { $ne: article._id } };
  const date = article.publishedAt || article.createdAt;

  const [prev, next] = await Promise.all([
    articleRepository
      .findOne({ ...base, publishedAt: { $lt: date } })
      .select("title slug coverImage publishedAt createdAt")
      .sort({ publishedAt: -1 }),
    articleRepository
      .findOne({ ...base, publishedAt: { $gt: date } })
      .select("title slug coverImage publishedAt createdAt")
      .sort({ publishedAt: 1 }),
  ]);

  res.json({ success: true, prev: prev || null, next: next || null });
}));

// GET /media/articles/:slug/comments
router.get("/articles/:slug/comments", asyncHandler(async (req, res) => {
  const article = await articleRepository.findOne({ slug: req.params.slug, status: "published" });
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });

  const comments = await ArticleComment.find({ article: article._id, approved: true })
    .select("name comment parent createdAt")
    .sort({ createdAt: 1 })
    .lean();

  res.json({ success: true, data: comments });
}));

// POST /media/articles/:slug/comments
router.post("/articles/:slug/comments", asyncHandler(async (req, res) => {
  const { name, email, comment, parent } = req.body;
  if (!name?.trim() || !email?.trim() || !comment?.trim()) {
    return res.status(400).json({ success: false, message: "Name, email, and comment are required" });
  }

  const article = await articleRepository.findOne({ slug: req.params.slug, status: "published" });
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });

  const created = await ArticleComment.create({
    article: article._id,
    name:    name.trim().slice(0, 100),
    email:   email.trim().toLowerCase().slice(0, 200),
    comment: comment.trim().slice(0, 2000),
    parent:  parent || null,
  });

  res.status(201).json({
    success: true,
    data: {
      _id:       created._id,
      name:      created.name,
      comment:   created.comment,
      parent:    created.parent,
      createdAt: created.createdAt,
    },
  });
}));

// GET /media/articles-categories?type=news|blog
router.get("/articles-categories", asyncHandler(async (req, res) => {
  const { type } = req.query;
  const match = { status: "published" };
  if (type) match.type = type;

  const categories = await articleRepository.distinct("category", match);
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

  const articles = await articleRepository.find(query)
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
    articleRepository.countDocuments(),
    articleRepository.countDocuments({ status: "published" }),
    articleRepository.countDocuments({ type: "news", status: "published" }),
    articleRepository.countDocuments({ type: "blog", status: "published" }),
    articleRepository.find({ status: "published" })
      .select("title slug type views publishedAt")
      .sort({ views: -1 })
      .limit(10),
    mediaItemRepository.countDocuments({ type: "image" }),
    mediaItemRepository.countDocuments({ type: "video" }),
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
    mediaItemRepository.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    mediaItemRepository.countDocuments(query),
    mediaItemRepository.distinct("album", { type: "image", status: "published" }),
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
    mediaItemRepository.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    mediaItemRepository.countDocuments(query),
    mediaItemRepository.distinct("category", { type: "video", status: "published" }),
  ]);

  res.json({
    success: true,
    data: items,
    categories: categories.filter(Boolean).sort(),
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
}));

// ─── PUBLIC: Press coverage ──────────────────────────────────────────────────

// GET /media/press  — published external press/media coverage cards
router.get("/press", asyncHandler(async (req, res) => {
  const cacheKey = "press:published";
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const items = await PressCoverage.find({ status: "published" })
    .select("publication date headline excerpt url image tilt tape featured order")
    .sort({ featured: -1, order: 1, createdAt: -1 })
    .lean();

  const payload = { success: true, data: items };
  cacheSet(cacheKey, payload);
  res.json(payload);
}));

// ─── ADMIN: Press coverage CRUD ───────────────────────────────────────────────

const PRESS_FIELDS = ["publication", "date", "headline", "excerpt", "url", "image", "tilt", "tape", "order", "featured", "status"];

// GET /media/admin/press
router.get("/admin/press", protect, admin, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const query = {};
  if (status) query.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [items, total] = await Promise.all([
    PressCoverage.find(query).sort({ order: 1, createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    PressCoverage.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: items,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
}));

// POST /media/admin/press
router.post("/admin/press", protect, admin, asyncHandler(async (req, res) => {
  const { publication, headline, url } = req.body;
  if (!publication || !headline || !url) {
    return res.status(400).json({ success: false, message: "Publication, headline, and URL are required" });
  }

  const payload = {};
  PRESS_FIELDS.forEach((f) => { if (req.body[f] !== undefined) payload[f] = req.body[f]; });

  const item = await PressCoverage.create(payload);
  cacheInvalidate("press:");
  res.status(201).json({ success: true, data: item });
}));

// PUT /media/admin/press/:id
router.put("/admin/press/:id", protect, admin, asyncHandler(async (req, res) => {
  const item = await PressCoverage.findById(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Press item not found" });

  PRESS_FIELDS.forEach((f) => { if (req.body[f] !== undefined) item[f] = req.body[f]; });
  await item.save();
  cacheInvalidate("press:");
  res.json({ success: true, data: item });
}));

// DELETE /media/admin/press/:id
router.delete("/admin/press/:id", protect, admin, asyncHandler(async (req, res) => {
  const item = await PressCoverage.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Press item not found" });
  cacheInvalidate("press:");
  res.json({ success: true, message: "Press item deleted" });
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
    articleRepository.find(query)
      .select("title slug type category status featured views publishedAt createdAt author")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    articleRepository.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: articles,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
  });
}));

// GET /media/admin/articles/:id
router.get("/admin/articles/:id", protect, admin, asyncHandler(async (req, res) => {
  const article = await articleRepository.findById(req.params.id);
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });
  res.json({ success: true, data: article });
}));

// POST /media/admin/articles
router.post("/admin/articles", protect, admin, asyncHandler(async (req, res) => {
  const { title, type, coverImage, excerpt, content, category, tags, author, status, featured, seo } = req.body;

  if (!title || !content) {
    return res.status(400).json({ success: false, message: "Title and content are required" });
  }

  // Auto-generate unique slug
  let baseSlug = generateSlug(title);
  let slug = baseSlug;
  let counter = 1;
  while (await articleRepository.findOne({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const article = await articleRepository.create({
    title, slug, type: type || "news", coverImage, excerpt, content,
    category: category || "General",
    tags: tags || [],
    author: author || "Autobacs Team",
    status: status || "draft",
    featured: featured || false,
    seo: normalizeSeo(seo),
  });

  cacheInvalidate("articles:");
  cacheInvalidate("trending:");
  res.status(201).json({ success: true, data: article });
}));

// PUT /media/admin/articles/:id
router.put("/admin/articles/:id", protect, admin, asyncHandler(async (req, res) => {
  const article = await articleRepository.findById(req.params.id);
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });

  const fields = ["title", "type", "coverImage", "excerpt", "content", "category", "tags", "author", "status", "featured"];
  fields.forEach((f) => { if (req.body[f] !== undefined) article[f] = req.body[f]; });

  // SEO overrides — normalized (trim/strip/clamp, drop unsafe URLs). Only touch
  // when sent; an admin who clears all fields resets to computed defaults.
  if (req.body.seo !== undefined) article.seo = normalizeSeo(req.body.seo);

  // Regenerate slug if title changed
  if (req.body.title && req.body.title !== article.title) {
    let baseSlug = generateSlug(req.body.title);
    let slug = baseSlug;
    let counter = 1;
    while (await articleRepository.findOne({ slug, _id: { $ne: article._id } })) {
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
  const article = await articleRepository.findByIdAndDelete(req.params.id);
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
    mediaItemRepository.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    mediaItemRepository.countDocuments(query),
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

  const item = await mediaItemRepository.create({
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
  const item = await mediaItemRepository.findById(req.params.id);
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
  const item = await mediaItemRepository.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Media item not found" });
  res.json({ success: true, message: "Media item deleted" });
}));

// ─── Admin: comment moderation ────────────────────────────────────────────────

// GET /media/admin/comments?articleSlug=&type=news|blog&approved=&page=&limit=
router.get("/admin/comments", protect, admin, asyncHandler(async (req, res) => {
  const { articleSlug, type, approved, page = 1, limit = 50 } = req.query;
  const filter = {};

  if (articleSlug) {
    const article = await articleRepository.findOne({ slug: articleSlug });
    if (!article) return res.json({ success: true, data: [], pagination: { page: 1, pages: 1, total: 0 } });
    filter.article = article._id;
  } else if (type && ["news", "blog"].includes(type)) {
    // Scope comments to articles of a given type (Blog admin vs Media/Press admin)
    const ids = await articleRepository.distinct("_id", { type });
    filter.article = { $in: ids };
  }
  if (approved !== undefined && approved !== "") {
    filter.approved = approved === "true";
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    ArticleComment.find(filter)
      .populate("article", "title slug type")
      .select("name email comment parent approved createdAt article")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    ArticleComment.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data,
    pagination: { page: Number(page), pages: Math.ceil(total / Number(limit)), total },
  });
}));

// PATCH /media/admin/comments/:id/approve  — toggle approved
router.patch("/admin/comments/:id/approve", protect, admin, asyncHandler(async (req, res) => {
  const doc = await ArticleComment.findById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: "Comment not found" });
  doc.approved = !doc.approved;
  await doc.save();
  res.json({ success: true, data: { _id: doc._id, approved: doc.approved } });
}));

// DELETE /media/admin/comments/:id  — also removes all direct replies
router.delete("/admin/comments/:id", protect, admin, asyncHandler(async (req, res) => {
  const doc = await ArticleComment.findById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: "Comment not found" });
  await Promise.all([
    ArticleComment.deleteOne({ _id: doc._id }),
    ArticleComment.deleteMany({ parent: doc._id }),
  ]);
  res.json({ success: true, message: "Comment deleted" });
}));

export default router;
