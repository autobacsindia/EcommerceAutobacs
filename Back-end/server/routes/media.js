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
import { revalidateFrontendTags } from "../services/frontendRevalidator.js";
import { articleTags } from "../utils/nextTags.js";
import cacheService from "../services/cacheService.js";
import { CACHE_VERSION } from "../services/cache/config.js";
import { invalidateCache } from "../middleware/cacheMiddleware.js";

const router = express.Router();

// ─── Response cache (shared Redis, via the house CacheService) ────────────────
//
// This was a module-local `new Map()`. That made it a SECOND, rival cache next
// to the established Redis one, and — because prod runs multiple Railway
// replicas — a per-process one: an admin publishing an article invalidated the
// Map on whichever replica served the write, while every other replica kept
// serving the stale article for the rest of the 5-minute TTL. Which replica you
// hit is luck, so the bug looked intermittent.
//
// Keys are namespaced under `<CACHE_VERSION>:media:` so the shared
// invalidateCache() helper reaches them by BOTH mechanisms: the tag index
// (deterministic) and its SCAN-glob substring fallback.
const CACHE_TTL_SECONDS = 5 * 60;
const mediaKey = (suffix) => `${CACHE_VERSION}:media:${suffix}`;

/**
 * Read-through cache for a public media response.
 * @param {string|null} suffix  key suffix, or null to bypass the cache entirely
 * @param {string[]} tags       invalidation tags (see MEDIA_TAGS)
 * @param {() => Promise<any>} fn  builds the payload on a miss
 */
const cached = (suffix, tags, fn) =>
  suffix === null ? fn() : cacheService.wrap(mediaKey(suffix), fn, { ttl: CACHE_TTL_SECONDS, tags });

// Tag names double as the invalidateCache() glob substrings, so a write path
// clears both the tagged keys and any untagged/legacy ones in a single call.
const MEDIA_TAGS = {
  articles: 'media:articles',
  article: 'media:article',
  trending: 'media:trending',
  press: 'media:press',
};

const ARTICLE_TYPES = ["news", "blog"];
/** Max page size a caller may request — bounds both the Mongo .limit() and the key space. */
const MAX_ARTICLE_LIMIT = 50;
const MAX_TRENDING_LIMIT = 20;
/** Absolute page ceiling, so `?page=1e9` can't ask Mongo to skip a billion docs. */
const MAX_PAGE = 1000;
/**
 * Only the first few pages are cached. Deep pages are rare, near-zero-hit-rate
 * traffic and would otherwise multiply the key space for no benefit — they still
 * serve correctly, straight from Mongo.
 */
const MAX_CACHED_PAGE = 5;

/** Parse a query integer, falling back and clamping. Never NaN. */
const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

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
  const { type, category, tag, search, featured, sort } = req.query;
  // Clamped, not trusted: `limit` reaches a Mongo .limit() and both reach the
  // cache key, so an unbounded value is both an expensive query and a way to
  // mint cache entries. The frontend asks for 6 (home shelf) and 12 (/blog).
  const page = clampInt(req.query.page, 1, 1, MAX_PAGE);
  const limit = clampInt(req.query.limit, 12, 1, MAX_ARTICLE_LIMIT);
  const skip = (page - 1) * limit;

  const normalizedType = ARTICLE_TYPES.includes(type) ? type : null;

  const query = { status: "published" };
  if (normalizedType) query.type = normalizedType;
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

  // Cache ONLY the requests whose key is drawn from a bounded value space.
  //
  // `search`, `category` and `tag` are free-form user input. This cache is now
  // shared Redis rather than a per-process Map, so letting them into the key
  // means `GET /media/articles?category=$RANDOM` in a loop mints unbounded
  // entries AND grows the `ctag:media:articles` tag set (which only empties on
  // an admin write) — real Upstash memory and per-command cost. Those requests
  // still serve correctly, they just go straight to Mongo.
  //
  // What remains is finite: type (3) x featured (2) x sort (2) x page (<=5) x
  // limit (clamped) — a few hundred keys at worst.
  const isCacheable = !search && !category && !tag && page <= MAX_CACHED_PAGE;
  const cacheKey = isCacheable
    ? `articles:${normalizedType || 'all'}:${featured === 'true' ? 'f' : ''}:${sort === 'views' ? 'views' : 'date'}:${page}:${limit}`
    : null;

  const payload = await cached(cacheKey, [MEDIA_TAGS.articles], async () => {
    const [articles, total] = await Promise.all([
      articleRepository.find(query)
        .select("title slug type coverImage excerpt category tags author featured views publishedAt createdAt")
        .sort(sortOrder)
        .skip(skip)
        .limit(limit),
      articleRepository.countDocuments(query),
    ]);

    return {
      success: true,
      data: articles,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  });

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
  const hit = await cacheService.get(mediaKey(cacheKey));

  // Cache hit: still increment views in background
  if (hit) {
    articleRepository.updateOne({ slug: req.params.slug }, { $inc: { views: 1 } }).catch(() => {});
    return res.json(hit);
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
  // Not awaited: the response must not wait on Redis, and a cache-write failure
  // is a miss next time, never a failed request.
  cacheService.set(mediaKey(cacheKey), payload, CACHE_TTL_SECONDS, [MEDIA_TAGS.article]);
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
  const { type } = req.query;
  // Same reasoning as /articles: `limit` feeds both a Mongo .limit() and the
  // shared-Redis cache key, so it is clamped rather than trusted.
  const limit = clampInt(req.query.limit, 5, 1, MAX_TRENDING_LIMIT);
  const normalizedType = ARTICLE_TYPES.includes(type) ? type : null;

  const query = { status: "published" };
  if (normalizedType) query.type = normalizedType;

  const payload = await cached(`trending:${normalizedType || 'all'}:${limit}`, [MEDIA_TAGS.trending], async () => {
    const articles = await articleRepository.find(query)
      .select("title slug type coverImage category views publishedAt")
      .sort({ views: -1 })
      .limit(limit);
    return { success: true, data: articles };
  });

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
  const payload = await cached("press:published", [MEDIA_TAGS.press], async () => {
    const items = await PressCoverage.find({ status: "published" })
      .select("publication date headline excerpt url image tilt tape featured order")
      .sort({ featured: -1, order: 1, createdAt: -1 })
      .lean();
    return { success: true, data: items };
  });

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
  invalidateCache(MEDIA_TAGS.press);
  res.status(201).json({ success: true, data: item });
}));

// PUT /media/admin/press/:id
router.put("/admin/press/:id", protect, admin, asyncHandler(async (req, res) => {
  const item = await PressCoverage.findById(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Press item not found" });

  PRESS_FIELDS.forEach((f) => { if (req.body[f] !== undefined) item[f] = req.body[f]; });
  await item.save();
  invalidateCache(MEDIA_TAGS.press);
  res.json({ success: true, data: item });
}));

// DELETE /media/admin/press/:id
router.delete("/admin/press/:id", protect, admin, asyncHandler(async (req, res) => {
  const item = await PressCoverage.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Press item not found" });
  invalidateCache(MEDIA_TAGS.press);
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

  // MEDIA_TAGS.article (the per-slug detail entries) must be cleared on EVERY
  // article write, not just for the article being written. A detail response
  // embeds `related[]` — up to 4 sibling articles — so publishing, renaming or
  // deleting article B leaves B in A's cached `related[]` for the full TTL, and
  // a deleted B renders a related link that 404s. Targeted per-slug deletes
  // cannot fix that: the stale copy lives under OTHER articles' keys.
  // Article writes are rare (it is a blog), so clearing the tag wholesale is the
  // cheap, correct choice.
  invalidateCache(MEDIA_TAGS.articles, MEDIA_TAGS.article, MEDIA_TAGS.trending);
  // Refresh the storefront's Next.js Data Cache: a published blog article shows
  // on the home journal shelf and at /<slug>. Without this the article stayed
  // invisible for the shelf's 300s / the page's 60s window.
  revalidateFrontendTags(articleTags(article));
  res.status(201).json({ success: true, data: article });
}));

// PUT /media/admin/articles/:id
router.put("/admin/articles/:id", protect, admin, asyncHandler(async (req, res) => {
  const article = await articleRepository.findById(req.params.id);
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });

  // Captured before any mutation, for the FRONTEND revalidation below: if the
  // slug or type moves, the old public URL's Next.js Data Cache entry must be
  // purged too. (The backend response cache needs no equivalent — the write
  // clears the whole MEDIA_TAGS.article tag.) A type change blog→news is the
  // live case: the article stops being served at /<slug>, and that page must
  // stop rendering it. The slug itself does not currently move — see the dead
  // regeneration block below.
  const previousSlug = article.slug;
  const previousType = article.type;

  const fields = ["title", "type", "coverImage", "excerpt", "content", "category", "tags", "author", "status", "featured"];
  fields.forEach((f) => { if (req.body[f] !== undefined) article[f] = req.body[f]; });

  // SEO overrides — normalized (trim/strip/clamp, drop unsafe URLs). Only touch
  // when sent; an admin who clears all fields resets to computed defaults.
  if (req.body.seo !== undefined) article.seo = normalizeSeo(req.body.seo);

  // DEAD BLOCK — deliberately left inert. The `fields.forEach` above has already
  // assigned req.body.title onto the document, so `req.body.title !== article.title`
  // is never true and the slug is never regenerated. The upshot is that an
  // article's URL is STABLE across title edits, which is the behaviour we want:
  // "fixing" this would move the public /<slug> of every renamed post, breaking
  // inbound links and churning the sitemap. Changing it is an SEO decision, not a
  // cleanup — capture the title before the loop only if that is the intent.
  // The invalidation below still handles a slug change so it stays correct if
  // this ever becomes live.
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
  // MEDIA_TAGS.article (the per-slug detail entries) must be cleared on EVERY
  // article write, not just for the article being written. A detail response
  // embeds `related[]` — up to 4 sibling articles — so publishing, renaming or
  // deleting article B leaves B in A's cached `related[]` for the full TTL, and
  // a deleted B renders a related link that 404s. Targeted per-slug deletes
  // cannot fix that: the stale copy lives under OTHER articles' keys.
  // Article writes are rare (it is a blog), so clearing the tag wholesale is the
  // cheap, correct choice.
  invalidateCache(MEDIA_TAGS.articles, MEDIA_TAGS.article, MEDIA_TAGS.trending);
  revalidateFrontendTags([
    ...articleTags(article),
    ...articleTags({ slug: previousSlug, type: previousType }),
  ]);
  res.json({ success: true, data: article });
}));

// DELETE /media/admin/articles/:id
router.delete("/admin/articles/:id", protect, admin, asyncHandler(async (req, res) => {
  const article = await articleRepository.findByIdAndDelete(req.params.id);
  if (!article) return res.status(404).json({ success: false, message: "Article not found" });
  // MEDIA_TAGS.article (the per-slug detail entries) must be cleared on EVERY
  // article write, not just for the article being written. A detail response
  // embeds `related[]` — up to 4 sibling articles — so publishing, renaming or
  // deleting article B leaves B in A's cached `related[]` for the full TTL, and
  // a deleted B renders a related link that 404s. Targeted per-slug deletes
  // cannot fix that: the stale copy lives under OTHER articles' keys.
  // Article writes are rare (it is a blog), so clearing the tag wholesale is the
  // cheap, correct choice.
  invalidateCache(MEDIA_TAGS.articles, MEDIA_TAGS.article, MEDIA_TAGS.trending);
  revalidateFrontendTags(articleTags(article));
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
